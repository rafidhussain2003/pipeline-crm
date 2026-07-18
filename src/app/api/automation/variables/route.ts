import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { listVariables, upsertVariable, VARIABLE_NAMESPACES } from "@/lib/workflow";

// ?workflowId= scopes to a workflow's variables; otherwise global variables.
export async function GET(req: NextRequest) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  const workflowId = req.nextUrl.searchParams.get("workflowId") || null;
  const variables = await listVariables(auth.session.companyId, workflowId);
  return NextResponse.json({ variables, namespaces: VARIABLE_NAMESPACES });
}

export async function POST(req: NextRequest) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const variable = await upsertVariable(auth.session.companyId, {
      workflowId: b?.workflowId || null,
      key: String(b?.key ?? ""),
      valueType: b?.valueType,
      value: b?.value,
      description: b?.description ?? null,
    });
    return NextResponse.json({ variable }, { status: 201 });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
