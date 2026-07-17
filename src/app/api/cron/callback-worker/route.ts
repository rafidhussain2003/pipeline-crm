import { NextRequest, NextResponse } from "next/server";
import { processDueReminders, reclaimStaleReminders, sweepOverdueCallbacks } from "@/lib/callbacks";

// Scheduled backstop for the callback reminder queue, hit by the same external
// scheduler as the other cron routes (CRON_SECRET header).
//
// Reminders are TIME-triggered, not event-triggered — nothing "kicks" the
// worker when a callback becomes due (its scheduled time simply arrives). That
// makes this route the PRIMARY trigger rather than a backstop, and it's why the
// queue is durable: a restart at any moment loses nothing, the next tick picks
// the rows up. Run it every minute.
//   1. reclaim rows a crashed worker left 'processing' past their reservation,
//   2. drain everything due (bounded batches, yields between passes),
//   3. sweep callbacks that are past the escalation window but whose reminder
//      rows never existed (e.g. every configured offset was already in the past).
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reclaimed = await reclaimStaleReminders(120);
  let processed = 0, sent = 0, failed = 0, skipped = 0;
  // Bounded drain: 50 × 100 = 5,000 reminders per tick. A larger backlog is
  // picked up by the next tick rather than monopolizing this instance.
  for (let i = 0; i < 50; i++) {
    const batch = await processDueReminders(100);
    processed += batch.processed;
    sent += batch.sent;
    failed += batch.failed;
    skipped += batch.skipped;
    if (batch.processed === 0) break;
  }
  const swept = await sweepOverdueCallbacks(500);
  return NextResponse.json({ ok: true, reclaimed, processed, sent, failed, skipped, swept });
}
