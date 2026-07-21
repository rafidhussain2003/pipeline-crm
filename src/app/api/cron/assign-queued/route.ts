import { NextRequest, NextResponse } from "next/server";
import { sweepAllCompanies } from "@/lib/assignment-queue";
import { assignmentEngine } from "@/lib/assignment";
import { runRecovery } from "@/lib/lifecycle/recovery";
import { escalateOverdueSla } from "@/lib/lifecycle/sla";

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
// Hardening: entry-point single-flight. If the scheduler fires again while
// the previous pass is still draining a large backlog, the new invocation
// acknowledges and exits instead of doubling every recovery/sweep/queue
// query — the classic cron-overlap retry storm. The inner passes carry their
// own guards too (defense in depth for the heartbeat-kicked paths).
let cronPassRunning = false;

export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (cronPassRunning) {
    return NextResponse.json({ ok: true, skipped: "previous assign-queued pass still running" });
  }
  cronPassRunning = true;
  try {
    return await runPass();
  } finally {
    cronPassRunning = false;
  }
}

async function runPass() {
  // Two backstops run here, both idempotent and convergent on the same
  // race-free atomic claim (so they can never double-assign):
  //  1. sweepAllCompanies() — the reactive owner-NULL sweep (unchanged): the
  //     fast path that drains any lead left unassigned.
  //  2. assignmentEngine.processQueue() — drains DUE rows of the durable
  //     assignment_jobs queue (failure-recovery retries with backoff). This
  //     is the distributed-worker-ready path; in a multi-instance future each
  //     instance's cron hit reserves a disjoint batch via SKIP LOCKED.
  // Phase 4: recover first (reclaim stale reservations from crashed workers +
  // re-queue any orphaned leads) so nothing is stuck, THEN drain.
  const recovery = await runRecovery();
  // Phase 5: escalate overdue-SLA queued leads (boost priority so they drain
  // first) BEFORE draining, so an SLA breach jumps the queue this same pass.
  const escalated = await escalateOverdueSla();
  const { companies, assigned } = await sweepAllCompanies();
  const jobs = await assignmentEngine.processQueue(200);
  return NextResponse.json({
    ok: true,
    companiesSwept: companies,
    assigned,
    queue: { processed: jobs.processed, assigned: jobs.assigned },
    recovery,
    slaEscalated: escalated,
  });
}
