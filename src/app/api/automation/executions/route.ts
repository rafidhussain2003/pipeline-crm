import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow } from "@/lib/workflow/guard";
import { listExecutions } from "@/lib/workflow";

export async function GET(req: NextRequest) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const executions = await listExecutions(auth.session.companyId, {
    workflowId: p.get("workflowId") || undefined,
    status: p.get("status") || undefined,
    limit: Number(p.get("limit")) || 50,
    offset: Number(p.get("offset")) || 0,
  });
  return NextResponse.json({ executions });
}
