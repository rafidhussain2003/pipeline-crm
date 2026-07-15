import { NextRequest, NextResponse } from "next/server";
import { processDueCapiEvents, reclaimStaleCapi, reconcileCapiEvents } from "@/lib/capi";

// Scheduled backstop for the Conversions API queue. Hit by the same external
// scheduler as the other cron routes (CRON_SECRET header). The primary trigger
// for sending is per-event (an enqueue kicks the worker immediately); this
// catches anything that path missed:
//   1. reclaim jobs a crashed worker left 'processing' past their reservation,
//   2. drain due rows (retries whose backoff elapsed),
//   3. reconcile — re-enqueue recent leads' current disposition so a conversion
//      lost between the in-memory enqueue and its durable insert is recovered
//      (idempotent via the (pixel, event_id) unique index — never a duplicate).
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reclaimed = await reclaimStaleCapi(120); // 2-minute reservation timeout
  const reconciled = await reconcileCapiEvents(60, 500);
  let processed = 0;
  let sent = 0;
  let failed = 0;
  // Drain in bounded batches so a large backlog yields rather than monopolizing.
  for (let i = 0; i < 50; i++) {
    const batch = await processDueCapiEvents(100);
    processed += batch.processed;
    sent += batch.sent;
    failed += batch.failed;
    if (batch.processed === 0) break;
  }
  return NextResponse.json({ ok: true, reclaimed, reconciledLeads: reconciled, processed, sent, failed });
}
