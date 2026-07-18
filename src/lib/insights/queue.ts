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

// How long to let a burst accumulate before draining. Ingesting ONE lead fires
// several insight-relevant events in sequence (lead.created → lead.queued /
// lead.assigned → lead.lifecycle_changed), each separated by an await. With the
// previous `setTimeout(…, 0)` every one of those started its own drain, so a
// single lead was recomputed 4–5 times — ~20 redundant DB round trips per lead
// (measured), which is precisely what this queue's "coalescing bursts" comment
// says it exists to prevent. A short window collapses the burst into one
// recompute; the work was already asynchronous, so nothing waits on it.
const COALESCE_MS = 250;
let scheduled: ReturnType<typeof setTimeout> | null = null;

// Schedule a recompute for a lead. Non-blocking, deduped, fire-and-forget.
export function enqueueInsightsRecompute(leadId: string): void {
  if (!leadId) return;
  pending.add(leadId);
  // A drain is already scheduled — this lead rides along with it rather than
  // starting a second pass over the same data.
  if (scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    void drain();
  }, COALESCE_MS);
}

// Test/inspection helper: drain to completion, including anything enqueued
// while a drain was already running.
export async function flushInsightsQueue(): Promise<void> {
  // Cancel the pending coalescing timer — the caller wants the work done NOW,
  // and leaving the timer armed would just fire a no-op drain later.
  if (scheduled) { clearTimeout(scheduled); scheduled = null; }
  while (pending.size > 0 || drainPromise) {
    await drain();
  }
}
export function pendingInsightsCount(): number {
  return pending.size;
}
