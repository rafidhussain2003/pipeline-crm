// SLA Engine (Phase 5) — assignment time-to-assign targets, deadlines,
// compliance, and escalation of overdue queued leads.
//
// Classification is config-driven (QueueConfig.sla) and easily extended with
// more signals; today it keys off lead priority (VIP) with source-class
// targets available in config. Escalation boosts an overdue queued lead's
// priority so it jumps the queue, emits a backend breach event (managers can
// subscribe — no UI), and is one-shot (deadline cleared) so it never re-fires.
import { db } from "@/db";
import { assignmentJobs } from "@/db/schema";
import { and, eq, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { eventBus } from "@/lib/events/bus";
import { metrics } from "@/lib/infra/metrics";
import { createLogger } from "@/lib/logger";
import type { QueueConfig } from "./config";

const logger = createLogger({ component: "sla" });

export type SlaClass = "vip" | "fresh" | "business" | "default";

export interface SlaClassification {
  slaClass: SlaClass;
  targetSeconds: number;
}

// Classify a lead into an SLA band and its time-to-assign target. Priority
// "high" is treated as VIP; a fresh provider lead (recently created, source is
// a real ad platform) gets the fresh target; otherwise the default. The order
// picks the MOST urgent applicable target.
export function classifyLeadSla(
  lead: { priority: string; createdAt: Date; sourcePlatform?: string | null },
  config: QueueConfig
): SlaClassification {
  const t = config.sla;
  if (lead.priority === "high") return { slaClass: "vip", targetSeconds: t.vipSeconds };
  const ageSeconds = (Date.now() - lead.createdAt.getTime()) / 1000;
  const freshPlatform = lead.sourcePlatform === "facebook" || lead.sourcePlatform === "website";
  if (freshPlatform && ageSeconds <= t.freshSeconds * 4) return { slaClass: "fresh", targetSeconds: t.freshSeconds };
  return { slaClass: "default", targetSeconds: t.defaultSeconds };
}

export function slaDeadlineFrom(referenceStart: Date, targetSeconds: number): Date {
  return new Date(referenceStart.getTime() + targetSeconds * 1000);
}

export function isSlaMet(referenceStart: Date, assignedAt: Date, targetSeconds: number): boolean {
  return assignedAt.getTime() - referenceStart.getTime() <= targetSeconds * 1000;
}

// Escalate overdue queued leads: boost their priority so they jump ahead, emit
// a breach event, and clear the deadline so a lead is escalated at most once.
// Global across tenants (one indexed UPDATE) for the cron; company-scopable.
export async function escalateOverdueSla(companyId?: string, boost = 200): Promise<number> {
  const where: SQL = companyId
    ? and(
        eq(assignmentJobs.companyId, companyId),
        isNotNull(assignmentJobs.slaDeadline),
        lt(assignmentJobs.slaDeadline, new Date()),
        sql`${assignmentJobs.status} in ('pending','failed')`
      )!
    : and(
        isNotNull(assignmentJobs.slaDeadline),
        lt(assignmentJobs.slaDeadline, new Date()),
        sql`${assignmentJobs.status} in ('pending','failed')`
      )!;

  const escalated = await db
    .update(assignmentJobs)
    .set({ priority: sql`${assignmentJobs.priority} + ${boost}`, slaDeadline: null, updatedAt: new Date() })
    .where(where)
    .returning({ id: assignmentJobs.id, leadId: assignmentJobs.leadId, companyId: assignmentJobs.companyId });

  if (escalated.length > 0) {
    metrics.increment("assignment.sla_escalated", escalated.length);
    logger.warn("sla_escalated", { count: escalated.length, boost });
    for (const j of escalated) {
      await eventBus.emit("assignment.sla_breached", { leadId: j.leadId, companyId: j.companyId });
    }
  }
  return escalated.length;
}
