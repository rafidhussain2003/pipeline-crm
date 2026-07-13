import { NextRequest, NextResponse } from "next/server";
import { sweepAllCompanies } from "@/lib/assignment-queue";

// Scheduled backstop for the auto-assignment engine. Hit by the same
// external scheduler as the other cron routes (Render Cron Job / cron-job.org)
// with the CRON_SECRET header. The primary trigger for draining queued leads
// is per-agent (a heartbeat that makes an agent available kicks the sweep
// immediately — see the heartbeat route); this catches anything that path
// missed: leads that arrived while every agent was offline and no heartbeat
// happened to follow, a server restart between the transition and the
// in-process kick, or an agent who was available all along but whose
// arrival-time assignment failed transiently. Runs every 1-2 minutes.
//
// It is a cheap no-op when there is no backlog (the sweep pre-filters to
// only companies that actually have an unassigned lead), so a tight
// schedule is fine and keeps worst-case queue latency low.
export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { companies, assigned } = await sweepAllCompanies();
  return NextResponse.json({ ok: true, companiesSwept: companies, assigned });
}
