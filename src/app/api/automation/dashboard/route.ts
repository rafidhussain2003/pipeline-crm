import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow } from "@/lib/workflow/guard";
import { workflowDashboard } from "@/lib/workflow";

export async function GET(_req: NextRequest) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ dashboard: await workflowDashboard(auth.session.companyId) });
}
