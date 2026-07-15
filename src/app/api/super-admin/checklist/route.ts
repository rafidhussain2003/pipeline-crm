import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { getLaunchChecklist } from "@/lib/health/checklist";

// Production Launch Checklist (Phase 12) — computed go/no-go from live state.
// Super-admin only.
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const checklist = await getLaunchChecklist();
  return NextResponse.json(checklist);
}
