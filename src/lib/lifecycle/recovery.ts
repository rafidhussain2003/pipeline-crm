// Recovery engine (Phase 4) — "nothing should become permanently stuck."
//
// Two recovery paths, both idempotent and safe to run on a schedule:
//   recoverStaleReservations() — a worker that reserved a job (status
//     "processing") then died leaves it stuck; this returns it to "pending"
//     once its reservation has timed out. (Failed-retry recovery is already
//     built in: reserveDue picks up status "failed" whose backoff has
//     elapsed.)
//   recoverOrphanedLeads() — a safety net that finds unassigned, non-terminal
//     leads with NO live queue job and enqueues them, so the durable queue is
//     always the complete source of pending work even after an interruption.
import { db } from "@/db";
import { assignmentJobs, automationSettings, leads } from "@/db/schema";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { assignmentQueue, kickJobWorker } from "@/lib/assignment/job-queue";
import { TERMINAL_DISPOSITIONS } from "@/lib/assignment/constants";
import { DEFAULT_QUEUE_CONFIG } from "./config";
import { createLogger } from "@/lib/logger";

const logger = createLogger({ component: "recovery" });

// Reclaim stale reservations across ALL tenants in one query. Uses the global
// default reservation timeout (a per-company override is a refinement; the
// default is a safe upper bound for "a worker should have finished by now").
export async function recoverStaleReservations(): Promise<number> {
  return assignmentQueue.reclaimStaleJobs(DEFAULT_QUEUE_CONFIG.reservationTimeoutSeconds);
}

// Enqueue unassigned, non-terminal, non-blacklisted leads that have no live
// job, for auto-assign companies. Bounded per run. Idempotent — the queue's
// partial unique index makes a duplicate enqueue a no-op.
export async function recoverOrphanedLeads(limitPerRun = 500): Promise<number> {
  const rows = await db
    .select({ id: leads.id, companyId: leads.companyId })
    .from(leads)
    .innerJoin(automationSettings, eq(automationSettings.companyId, leads.companyId))
    .where(
      and(
        isNull(leads.ownerId),
        isNull(leads.deletedAt),
        eq(leads.isBlacklisted, false),
        notInArray(leads.disposition, TERMINAL_DISPOSITIONS),
        eq(automationSettings.autoAssignEnabled, true),
        sql`NOT EXISTS (SELECT 1 FROM ${assignmentJobs} j WHERE j.lead_id = ${leads.id} AND j.status IN ('pending','processing','failed'))`
      )
    )
    .limit(limitPerRun);

  let recovered = 0;
  for (const r of rows) {
    await assignmentQueue.enqueue({ leadId: r.id, companyId: r.companyId, source: "sweep" });
    recovered++;
  }
  if (recovered > 0) {
    kickJobWorker();
    logger.info("orphaned_leads_recovered", { count: recovered });
  }
  return recovered;
}

// Convenience: run the whole recovery pass (used by the cron backstop).
export async function runRecovery(): Promise<{ reclaimed: number; orphaned: number }> {
  const reclaimed = await recoverStaleReservations();
  const orphaned = await recoverOrphanedLeads();
  return { reclaimed, orphaned };
}
