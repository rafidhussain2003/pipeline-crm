import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { getWorkflowSettings, updateWorkflowSettings, WORKFLOW_REPORTS } from "@/lib/workflow";

export async function GET(_req: NextRequest) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  const settings = await getWorkflowSettings(auth.session.companyId);
  return NextResponse.json({ settings, reports: WORKFLOW_REPORTS });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireWorkflow("workflow:admin");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const settings = await updateWorkflowSettings(auth.session.companyId, {
      defaultMaxRetries: b?.defaultMaxRetries !== undefined ? Number(b.defaultMaxRetries) : undefined,
      defaultBackoffSeconds: b?.defaultBackoffSeconds !== undefined ? Number(b.defaultBackoffSeconds) : undefined,
      executionRetentionDays: b?.executionRetentionDays !== undefined ? Number(b.executionRetentionDays) : undefined,
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
