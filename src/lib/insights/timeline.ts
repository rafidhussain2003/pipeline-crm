// Phase 9 — unified lead timeline builder. Merges every event source that
// already exists for a lead (creation, assignments, lifecycle stage changes,
// notes, and audit-log entries) into one chronological, human-readable feed.
// Read-only: no new table, no new writes — it renders back events other code
// paths already record. Extracted into lib so both the timeline API route and
// the Phase 9 verification test build the exact same feed.
import { db } from "@/db";
import { leads, leadSources, leadNotes, assignmentLog, auditLog, leadLifecycleEvents, users } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

export type TimelineEvent = { id: string; at: Date; label: string; detail: string | null; actor: string | null };

// Turn a raw audit action ("lead.disposition_changed") into a readable label.
function humanizeAudit(action: string, metadata: unknown): { label: string; detail: string | null } | null {
  const m = (metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {}) as Record<string, unknown>;
  // Creation is rendered from the synthetic "Lead created" event below.
  if (action.startsWith("lead.created_from_")) return null;
  switch (action) {
    case "lead.disposition_changed":
      return { label: "Status changed", detail: m.from && m.to ? `${m.from} → ${m.to}` : m.to ? `→ ${m.to}` : null };
    case "lead.recycled":
      return { label: "Recycled", detail: typeof m.reason === "string" ? m.reason : null };
    case "lead.blacklisted":
      return { label: "Blacklisted from auto-assignment", detail: null };
    case "lead.updated":
      return { label: "Updated", detail: Array.isArray(m.changedFields) ? (m.changedFields as string[]).join(", ") : null };
    case "note.added":
      return { label: "Note added", detail: null };
    case "attachment.added":
      return { label: "Attachment added", detail: typeof m.fileName === "string" ? m.fileName : null };
    default:
      return { label: action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase()), detail: null };
  }
}

const LIFECYCLE_LABELS: Record<string, string> = {
  queued: "Queued (waiting for an agent)",
  contacted: "Contacted",
  in_progress: "In progress",
  follow_up: "Follow-up scheduled",
  won: "Won",
  lost: "Lost",
  closed: "Closed",
};

// Build the chronological (newest-first) timeline for a lead. Company-scoped:
// returns null if the lead isn't in this company.
export async function buildLeadTimeline(leadId: string, companyId: string): Promise<TimelineEvent[] | null> {
  const [lead] = await db
    .select({ id: leads.id, createdAt: leads.createdAt, sourcePlatform: leadSources.platform, sourceName: leadSources.pageName })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);
  if (!lead) return null;

  const [assignments, auditEntries, lifecycle, notes] = await Promise.all([
    db
      .select({ id: assignmentLog.id, agentName: users.name, ruleUsed: assignmentLog.ruleUsed, assignedAt: assignmentLog.assignedAt })
      .from(assignmentLog)
      .leftJoin(users, eq(assignmentLog.assignedTo, users.id))
      .where(eq(assignmentLog.leadId, leadId))
      .orderBy(desc(assignmentLog.assignedAt)),
    db
      .select({ id: auditLog.id, action: auditLog.action, metadata: auditLog.metadata, createdAt: auditLog.createdAt, userName: users.name })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.entityType, "lead"), eq(auditLog.entityId, leadId)))
      .orderBy(desc(auditLog.createdAt)),
    db
      .select({ id: leadLifecycleEvents.id, toStage: leadLifecycleEvents.toStage, reason: leadLifecycleEvents.reason, createdAt: leadLifecycleEvents.createdAt })
      .from(leadLifecycleEvents)
      .where(eq(leadLifecycleEvents.leadId, leadId))
      .orderBy(desc(leadLifecycleEvents.createdAt)),
    db
      .select({ id: leadNotes.id, body: leadNotes.body, createdAt: leadNotes.createdAt, authorName: users.name })
      .from(leadNotes)
      .leftJoin(users, eq(leadNotes.authorId, users.id))
      .where(eq(leadNotes.leadId, leadId))
      .orderBy(desc(leadNotes.createdAt)),
  ]);

  const events: TimelineEvent[] = [];

  const sourceLabel =
    lead.sourcePlatform === "facebook" ? "Facebook" : lead.sourcePlatform === "website" ? lead.sourceName || "Website form" : lead.sourcePlatform ? lead.sourceName || lead.sourcePlatform : "Manual entry";
  events.push({ id: `created:${lead.id}`, at: lead.createdAt, label: "Lead created", detail: `via ${sourceLabel}`, actor: null });

  for (const a of assignments) {
    events.push({ id: `assignment:${a.id}`, at: a.assignedAt, label: a.agentName ? `Assigned to ${a.agentName}` : "Assigned", detail: a.ruleUsed, actor: null });
  }

  for (const e of lifecycle) {
    // "new" is creation and "assigned" is shown from assignment_log — skip both.
    if (e.toStage === "new" || e.toStage === "assigned") continue;
    events.push({ id: `lifecycle:${e.id}`, at: e.createdAt, label: LIFECYCLE_LABELS[e.toStage] || `Status: ${e.toStage}`, detail: e.reason, actor: null });
  }

  for (const n of notes) {
    events.push({ id: `note:${n.id}`, at: n.createdAt, label: "Note added", detail: n.body.length > 140 ? `${n.body.slice(0, 140)}…` : n.body, actor: n.authorName });
  }

  for (const e of auditEntries) {
    const h = humanizeAudit(e.action, e.metadata);
    if (!h) continue;
    events.push({ id: `audit:${e.id}`, at: e.createdAt, label: h.label, detail: h.detail, actor: e.userName });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events;
}
