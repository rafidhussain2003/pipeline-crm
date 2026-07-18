import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { upsertVariable, deleteVariable } from "@/lib/workflow";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    const variable = await upsertVariable(auth.session.companyId, {
      id,
      workflowId: b?.workflowId || null,
      key: String(b?.key ?? ""),
      valueType: b?.valueType,
      value: b?.value,
      description: b?.description ?? null,
    });
    return NextResponse.json({ variable });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteVariable(auth.session.companyId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
