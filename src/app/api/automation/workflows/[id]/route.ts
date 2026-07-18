import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { getWorkflow, updateWorkflow, deleteWorkflow } from "@/lib/workflow";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    return NextResponse.json({ workflow: await getWorkflow(auth.session.companyId, id) });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    const workflow = await updateWorkflow(auth.session.companyId, auth.session.userId, id, {
      name: b?.name !== undefined ? String(b.name) : undefined,
      description: b?.description !== undefined ? b.description : undefined,
      triggerType: b?.triggerType !== undefined ? String(b.triggerType) : undefined,
      triggerConfig: b?.triggerConfig !== undefined ? b.triggerConfig : undefined,
      conditions: b?.conditions !== undefined ? b.conditions : undefined,
      retryConfig: b?.retryConfig !== undefined ? b.retryConfig : undefined,
      actions: b?.actions !== undefined ? (Array.isArray(b.actions) ? b.actions : []) : undefined,
    });
    return NextResponse.json({ workflow });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteWorkflow(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
