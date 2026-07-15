import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { getJobDashboard } from "@/lib/health/jobs";

// Background Job Dashboard (Phase 12) — running/queued/failed/dead-letter across
// the assignment + Conversions API queues, retry counts, avg processing time.
// Super-admin only.
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const dashboard = await getJobDashboard();
  return NextResponse.json(dashboard);
}
