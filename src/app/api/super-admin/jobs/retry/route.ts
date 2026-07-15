import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { retryDeadLetterJob } from "@/lib/health/jobs";
import { kickJobWorker } from "@/lib/assignment/job-queue";
import { kickCapiWorker } from "@/lib/capi";

// Retry a dead-lettered job (super-admin). Idempotent — requeues the row and
// kicks the relevant worker.
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const queue = String(body?.queue || "");
  const id = String(body?.id || "");
  if (!queue || !id) return NextResponse.json({ error: "queue and id are required" }, { status: 400 });

  const ok = await retryDeadLetterJob(queue, id);
  if (!ok) return NextResponse.json({ error: "Not a dead-lettered job (or not found)" }, { status: 404 });

  if (queue === "assignment") kickJobWorker();
  else if (queue === "conversions_api") kickCapiWorker();

  await recordAudit({ companyId: null, userId: auth.session.userId, action: "admin.job_retried", entityType: "job", entityId: id, metadata: { queue } });
  return NextResponse.json({ ok: true });
}
