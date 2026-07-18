import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { runRetrySweep } from "@/lib/workflow";

// Company-scoped retry sweep — the manual "process due retries now" button. The
// unscoped backstop runs on a schedule (api/cron/workflow-retry).
export async function POST(_req: NextRequest) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  try {
    const result = await runRetrySweep(auth.session.companyId);
    return NextResponse.json({ result });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
