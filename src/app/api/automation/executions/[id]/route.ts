import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { getExecution } from "@/lib/workflow";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json({ execution: await getExecution(auth.session.companyId, id) });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
