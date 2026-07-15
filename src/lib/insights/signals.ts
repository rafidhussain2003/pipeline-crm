// Phase 9 — insight signal gathering. Collects every structured fact the
// insight engine needs (the lead row, its source, owner, activity counts and
// last-activity time) in a handful of bounded, indexed queries. Kept separate
// from src/lib/ai/context.ts (which the existing scoring engine owns) so this
// phase adds the richer signals — phone/email presence, source platform,
// recycle count, business-hours-of-submission — WITHOUT modifying that module.
import { db } from "@/db";
import { leads, users, leadSources, leadNotes, auditLog, assignmentLog, leadLifecycleEvents } from "@/db/schema";
import { and, eq, count, max } from "drizzle-orm";

export type InsightSignals = {
  leadId: string;
  companyId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  disposition: string;
  lifecycleStage: string;
  priority: string;
  isBlacklisted: boolean;
  isDuplicate: boolean;
  recycleCount: number;
  ownerId: string | null;
  ownerName: string | null;
  sourceId: string | null;
  sourcePlatform: string | null; // "facebook" | "website" | "google" | ...
  sourceName: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignedAt: Date | null;
  followUpAt: Date | null;
  submittedInBusinessHours: boolean; // 8:00–18:00 server-local, Mon–Fri
  assignmentCount: number;
  noteCount: number;
  lastActivityAt: Date; // max(created, updated, last note, last audit, last assignment, last lifecycle)
};

function isBusinessHours(d: Date): boolean {
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const hour = d.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

export async function gatherInsightSignals(leadId: string): Promise<InsightSignals | null> {
  const [row] = await db
    .select({
      id: leads.id,
      companyId: leads.companyId,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      disposition: leads.disposition,
      lifecycleStage: leads.lifecycleStage,
      priority: leads.priority,
      isBlacklisted: leads.isBlacklisted,
      isDuplicate: leads.isDuplicate,
      recycleCount: leads.recycleCount,
      ownerId: leads.ownerId,
      ownerName: users.name,
      sourceId: leads.sourceId,
      sourcePlatform: leadSources.platform,
      sourceName: leadSources.pageName,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      assignedAt: leads.assignedAt,
      followUpAt: leads.followUpAt,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!row) return null;

  const [[assignAgg], [noteAgg], [lastNote], [lastAudit], [lastAssign], [lastLifecycle]] = await Promise.all([
    db.select({ value: count() }).from(assignmentLog).where(eq(assignmentLog.leadId, leadId)),
    db.select({ value: count() }).from(leadNotes).where(eq(leadNotes.leadId, leadId)),
    db.select({ at: max(leadNotes.createdAt) }).from(leadNotes).where(eq(leadNotes.leadId, leadId)),
    db.select({ at: max(auditLog.createdAt) }).from(auditLog).where(and(eq(auditLog.entityType, "lead"), eq(auditLog.entityId, leadId))),
    db.select({ at: max(assignmentLog.assignedAt) }).from(assignmentLog).where(eq(assignmentLog.leadId, leadId)),
    db.select({ at: max(leadLifecycleEvents.createdAt) }).from(leadLifecycleEvents).where(eq(leadLifecycleEvents.leadId, leadId)),
  ]);

  const candidates = [row.createdAt, row.updatedAt, lastNote?.at, lastAudit?.at, lastAssign?.at, lastLifecycle?.at]
    .filter((d): d is Date => d instanceof Date);
  const lastActivityAt = candidates.reduce((mx, d) => (d.getTime() > mx.getTime() ? d : mx), row.createdAt);

  return {
    leadId: row.id,
    companyId: row.companyId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    hasPhone: !!(row.phone && row.phone.trim()),
    hasEmail: !!(row.email && row.email.trim()),
    disposition: row.disposition,
    lifecycleStage: row.lifecycleStage,
    priority: row.priority,
    isBlacklisted: row.isBlacklisted,
    isDuplicate: row.isDuplicate,
    recycleCount: row.recycleCount,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    sourceId: row.sourceId,
    sourcePlatform: row.sourcePlatform,
    sourceName: row.sourceName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assignedAt: row.assignedAt,
    followUpAt: row.followUpAt,
    submittedInBusinessHours: isBusinessHours(row.createdAt),
    assignmentCount: assignAgg.value,
    noteCount: noteAgg.value,
    lastActivityAt,
  };
}

// A friendly label for the lead's origin, derived from the source platform.
export function sourceLabel(signals: InsightSignals): string {
  if (!signals.sourcePlatform) return "Manual entry";
  switch (signals.sourcePlatform) {
    case "facebook":
      return "Facebook";
    case "website":
      return signals.sourceName || "Website Form";
    case "google":
      return "Google";
    default:
      return signals.sourceName || signals.sourcePlatform.charAt(0).toUpperCase() + signals.sourcePlatform.slice(1);
  }
}
