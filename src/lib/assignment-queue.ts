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
//
// Hardening: the guard now lives INSIDE sweepCompanyQueuedLeads, so every
// caller shares it — previously only kickCompanySweep checked it, which let
// the cron's sweepAllCompanies run the same company's sweep concurrently
// with a heartbeat-kicked one (harmless for correctness thanks to the
// atomic claim, but a pure duplicate-query burst). A kick that arrives
// mid-sweep is remembered (sweepRekick) and honored once after the current
// sweep finishes, so a lead arriving mid-sweep keeps event-driven latency
// instead of silently waiting for the cron backstop.
const sweepInFlight = new Set<string>();
const sweepRekick = new Set<string>();

export async function sweepCompanyQueuedLeads(companyId: string): Promise<{ assigned: number; attempted: number }> {
  if (sweepInFlight.has(companyId)) {
    metrics.increment("assignment.overlap_skipped");
    logger.debug("sweep_skipped_inflight", { companyId });
    return { assigned: 0, attempted: 0 };
  }
  sweepInFlight.add(companyId);
  try {
    return await runCompanySweep(companyId);
  } finally {
    sweepInFlight.delete(companyId);
  }
}

async function runCompanySweep(companyId: string): Promise<{ assigned: number; attempted: number }> {
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
// kicks during a sweep free, and a kick that lands mid-sweep coalesces into
// exactly one trailing sweep (missed-wakeup protection, never a loop).
export function kickCompanySweep(companyId: string): void {
  if (sweepInFlight.has(companyId)) {
    sweepRekick.add(companyId);
    return;
  }
  void runKickedSweep(companyId);
}

function runKickedSweep(companyId: string): Promise<void> {
  return sweepCompanyQueuedLeads(companyId)
    .then(() => undefined)
    .catch((err) => {
      logger.error("queue_sweep_failed", { companyId, error: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      // Honor at most ONE coalesced kick that arrived while we were running.
      if (sweepRekick.delete(companyId) && !sweepInFlight.has(companyId)) {
        void runKickedSweep(companyId);
      }
    });
}

// Cron backstop: sweep every active company that actually has queued
// leads. The EXISTS pre-filter keeps this a cheap no-op for the common
// case (no backlog anywhere) instead of iterating every tenant.
//
// Single-flight per process: an overlapping cron tick (previous pass still
// draining a large backlog) skips instead of doubling every query — the
// next tick covers whatever remains. Outcomes are unchanged; only the
// duplicate work is gone.
let allSweepRunning = false;
export async function sweepAllCompanies(): Promise<{ companies: number; assigned: number }> {
  if (allSweepRunning) {
    metrics.increment("assignment.overlap_skipped");
    logger.warn("sweep_all_overlap_skipped", {});
    return { companies: 0, assigned: 0 };
  }
  allSweepRunning = true;
  try {
    return await runAllCompaniesSweep();
  } finally {
    allSweepRunning = false;
  }
}

async function runAllCompaniesSweep(): Promise<{ companies: number; assigned: number }> {
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
