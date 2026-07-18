import { NextRequest, NextResponse } from "next/server";
import { runRetrySweep } from "@/lib/workflow";

// Scheduled backstop for the Workflow Automation retry engine. Hit by the same
// external scheduler as the other cron routes (with the CRON_SECRET header),
// every 1–2 minutes. Re-runs every execution whose exponential-backoff retry is
// now due (status='retrying', next_retry_at<=now) across all companies. Cheap
// when there is no backlog — the sweep is a single indexed scan.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRetrySweep(undefined, 200);
  return NextResponse.json({ ok: true, ...result });
}
