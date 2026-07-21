import { NextRequest, NextResponse } from "next/server";
import { recycleAllCompanies } from "@/lib/lifecycle/recycling";
import { rebalanceAllCompanies } from "@/lib/lifecycle/rebalancing";

// Periodic maintenance pass for the autonomous queue — called by the external
// scheduler (Render Cron / cron-job.org) with the CRON_SECRET header. Sweeps
// every tenant in one pass; both engines are per-company config-gated and
// multi-tenant isolated.
//
// Phase 4 rewrote this: the old body called assignLead() on already-OWNED
// leads, which the atomic claim (WHERE owner_id IS NULL) turned into a no-op.
// It now delegates to the real recycling engine (which RELEASES a lead from an
// agent who can't work it, then re-queues it through the assignment engine)
// and the rebalancing engine (which levels workload across eligible agents).
// Hardening: entry-point single-flight against scheduler overlap — see the
// assign-queued route for the rationale. The recycle/rebalance passes also
// guard themselves; this simply refuses the duplicate work at the door.
let cronPassRunning = false;

export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (cronPassRunning) {
    return NextResponse.json({ ok: true, skipped: "previous recycle pass still running" });
  }
  cronPassRunning = true;
  try {
    const recycle = await recycleAllCompanies();
    const rebalance = await rebalanceAllCompanies();

    return NextResponse.json({
      ok: true,
      recycle: { companies: recycle.companies, recycled: recycle.recycled },
      rebalance: { companies: rebalance.companies, moved: rebalance.moved },
    });
  } finally {
    cronPassRunning = false;
  }
}
