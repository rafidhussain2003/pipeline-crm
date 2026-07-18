import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { listWorkflows, createWorkflow } from "@/lib/workflow";

export async function GET(req: NextRequest) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const workflows = await listWorkflows(auth.session.companyId, {
    status: p.get("status") || undefined,
    triggerType: p.get("triggerType") || undefined,
    search: p.get("search") || undefined,
    limit: Number(p.get("limit")) || 50,
    offset: Number(p.get("offset")) || 0,
  });
  return NextResponse.json({ workflows });
}

export async function POST(req: NextRequest) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const workflow = await createWorkflow(auth.session.companyId, auth.session.userId, {
      name: String(b?.name ?? ""),
      description: b?.description ?? null,
      triggerType: String(b?.triggerType ?? ""),
      triggerConfig: b?.triggerConfig ?? null,
      conditions: b?.conditions ?? null,
      retryConfig: b?.retryConfig ?? null,
      actions: Array.isArray(b?.actions) ? b.actions : [],
    });
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
