// Phase 9 — asynchronous insight recompute queue. The whole point: recomputing
// a lead's insight must NEVER delay lead assignment or an API response. So the
// event listeners (and any caller) only ever call enqueue(), which is O(1) and
// returns immediately; the actual recompute happens on a drained microtask,
// coalescing bursts (a lead touched 5 times in a second recomputes once).
//
// This is the same "in-process now, durable worker later" seam used elsewhere
// in the app (the assignment JobQueue, the event bus): the call site
// (enqueueInsightsRecompute) does not change when a Redis/BullMQ-backed worker
// replaces the in-process drain below.
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/infra/metrics";
import { recomputeLeadInsights } from "./service";

const logger = createLogger({ component: "insights-queue" });

const pending = new Set<string>();
const MAX_BATCH = 50;
// The single in-flight drain, shared by every caller (the deferred macrotask
// AND flushInsightsQueue) so a second caller AWAITS the running drain instead
// of racing or short-circuiting past it.
let drainPromise: Promise<void> | null = null;

function drain(): Promise<void> {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    while (pending.size > 0) {
      const batch = Array.from(pending).slice(0, MAX_BATCH);
      for (const leadId of batch) pending.delete(leadId);
      // Sequential with per-item isolation: a bad lead never stops the rest,
      // and we never fan out an unbounded number of concurrent DB queries.
      for (const leadId of batch) {
        const started = Date.now();
        try {
          await recomputeLeadInsights(leadId);
          metrics.recordTiming("insights.recompute_ms", Date.now() - started);
        } catch (err) {
          logger.error("insight_recompute_failed", { leadId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  })().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

// Schedule a recompute for a lead. Non-blocking, deduped, fire-and-forget.
export function enqueueInsightsRecompute(leadId: string): void {
  if (!leadId) return;
  pending.add(leadId);
  // Defer to a macrotask so the caller (an event emit inside assignment, or an
  // API handler) returns before any recompute work starts.
  setTimeout(() => {
    void drain();
  }, 0);
}

// Test/inspection helper: drain to completion, including anything enqueued
// while a drain was already running.
export async function flushInsightsQueue(): Promise<void> {
  while (pending.size > 0 || drainPromise) {
    await drain();
  }
}
export function pendingInsightsCount(): number {
  return pending.size;
}
