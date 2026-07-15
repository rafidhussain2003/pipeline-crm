import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { getSystemHealth } from "@/lib/health";

// Per-subsystem health for the platform owner (Phase 10): database, queue,
// assignment, presence, meta, website forms, mailbox, operations, AI — each
// Healthy / Warning / Critical, plus latency timings and cache stats. Returns
// 503 when the overall status is critical so an external monitor can alert on
// it; 200 otherwise. Super-admin only (no company admin ever sees this).
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const health = await getSystemHealth();
  return NextResponse.json(health, { status: health.status === "critical" ? 503 : 200 });
}
