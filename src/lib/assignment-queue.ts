// The unassigned-lead queue. There is no separate queue table — a lead
// with ownerId NULL *is* the queue entry (single source of truth, nothing
// to keep in sync, survives restarts by construction). This module drains
// it. Two triggers keep the queue moving with zero manager involvement:
//
//   1. kickCompanySweep() — fired (fire-and-forget) by the heartbeat route
//      the moment an agent transitions back to assignment-eligible, so
//      queued leads flow to a returning agent within one heartbeat.
//   2. /api/cron/assign-queued — the scheduled backstop that drains any
//      backlog the moment-based trigger missed (server restarted between
//      the transition and the sweep, agents were eligible all along but
//      every arrival-time attempt failed transiently, etc).
//
// Both funnel into the same sweep, and the sweep funnels every lead into
// the same assignLead() the arrival path uses — one assignment
// implementation, everywhere.
import { db } from "@/db";
import { automationSettings, companies, leads } from "@/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { assignLead, TERMINAL_DISPOSITIONS } from "./assignment";
import { getProgressiveConfig } from "./assignment/progressive/config";
import { runProgressiveCycle } from "./assignment/progressive/engine";
import { featureService } from "./features";
import { notInArray } from "drizzle-orm";
import { createLogger } from "./logger";
import { metrics } from "./infra/metrics";

const logger = createLogger({ component: "assignment-queue" });

// Bounds one sweep invocation per company. 200 assignments is comfortably
// more than any realistic between-sweeps backlog at the current scale; a
// larger backlog simply drains across successive cron runs instead of one
// unbounded burst — deliberate burst protection for the DB, not a cap on
// throughput.
const MAX_LEADS_PER_COMPANY_PER_SWEEP = 200;

// One in-flight sweep per company per process — a burst of heartbeats from
// agents all coming online at 9am must not stampede N parallel sweeps over
// the same queue (they'd all serialize on the per-company assignment lock
// anyway, doing redundant work).
const sweepInFlight = new Set<string>();

export async function sweepCompanyQueuedLeads(companyId: string): Promise<{ assigned: number; attempted: number }> {
  // Phase 17: when Progressive Lead Release is ON, the backlog is drained by
  // the release engine (paced, tier-batched, reserve-aware) instead of this
  // full drain. Both triggers that reach here (heartbeat kick + cron) flow
  // through unchanged — no new workers, no polling. OFF = the loop below,
  // byte-for-byte as before.
  //
  // Phase 18: the module must also be ENTITLED (featureService) — if the
  // Platform Owner disables Progressive Lead Release for this company, the
  // engine behaves exactly as if the company toggle were off, even though
  // their saved settings still say enabled. Both checks are cached reads.
  const progressive = await getProgressiveConfig(companyId);
  if (progressive.enabled && (await featureService.isEnabled(companyId, "progressive_lead_release"))) {
    const cycle = await runProgressiveCycle(companyId, progressive);
    return { assigned: cycle.assigned, attempted: cycle.attempted };
  }

  const queued = await db
    .select({ id: leads.id, requiredSkillId: leads.requiredSkillId })
    .from(leads)
    .where(
      and(
        eq(leads.companyId, companyId),
        isNull(leads.ownerId),
        isNull(leads.deletedAt),
        eq(leads.isBlacklisted, false),
        notInArray(leads.disposition, TERMINAL_DISPOSITIONS)
      )
    )
    // High-priority leads jump the queue; within a priority band, oldest
    // first (FIFO — the lead that has waited longest gets the next agent).
    .orderBy(desc(sql`${leads.priority} = 'high'`), asc(leads.createdAt))
    .limit(MAX_LEADS_PER_COMPANY_PER_SWEEP);

  let assigned = 0;
  let attempted = 0;
  for (const lead of queued) {
    attempted++;
    const agentId = await assignLead(lead.id, companyId, lead.requiredSkillId, null, { source: "sweep" });
    if (agentId) {
      assigned++;
    } else {
      // A null from the sweep means a pool-level condition (no eligible
      // agents, outside working hours, auto-assign off) — every remaining
      // lead in this batch would hit the same wall, so stop instead of
      // burning N futile attempts. Blacklisted/terminal leads can't cause
      // this: the query above already excludes them.
      break;
    }
  }

  if (assigned > 0) {
    metrics.increment("assignment.queue_drained", assigned);
    logger.info("queue_sweep_done", { companyId, assigned, attempted, queuedBatch: queued.length });
  }
  return { assigned, attempted };
}

// Fire-and-forget entry point for the heartbeat route. Never awaited by
// the caller and never throws into it; the in-flight guard makes repeat
// kicks during a sweep free.
export function kickCompanySweep(companyId: string): void {
  if (sweepInFlight.has(companyId)) return;
  sweepInFlight.add(companyId);
  sweepCompanyQueuedLeads(companyId)
    .catch((err) => {
      logger.error("queue_sweep_failed", { companyId, error: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => sweepInFlight.delete(companyId));
}

// Cron backstop: sweep every active company that actually has queued
// leads. The EXISTS pre-filter keeps this a cheap no-op for the common
// case (no backlog anywhere) instead of iterating every tenant.
export async function sweepAllCompanies(): Promise<{ companies: number; assigned: number }> {
  const companiesWithQueue = await db
    .select({ companyId: automationSettings.companyId })
    .from(automationSettings)
    .innerJoin(companies, eq(automationSettings.companyId, companies.id))
    .where(
      and(
        eq(automationSettings.autoAssignEnabled, true),
        isNull(companies.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM ${leads}
          WHERE ${leads.companyId} = ${automationSettings.companyId}
            AND ${leads.ownerId} IS NULL
            AND ${leads.deletedAt} IS NULL
            AND ${leads.isBlacklisted} = false
        )`
      )
    );

  let totalAssigned = 0;
  for (const { companyId } of companiesWithQueue) {
    const { assigned } = await sweepCompanyQueuedLeads(companyId);
    totalAssigned += assigned;
  }
  return { companies: companiesWithQueue.length, assigned: totalAssigned };
}
