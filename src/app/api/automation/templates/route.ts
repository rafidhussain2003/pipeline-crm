import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { listTemplates, instantiateTemplate } from "@/lib/workflow";

export async function GET(_req: NextRequest) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  const templates = listTemplates().map((t) => ({ key: t.key, name: t.name, description: t.description, category: t.category, triggerType: t.definition.triggerType, actionCount: t.definition.actions?.length ?? 0 }));
  return NextResponse.json({ templates });
}

// Instantiate a template into a new draft workflow.
export async function POST(req: NextRequest) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  const { key } = await req.json().catch(() => ({ key: "" }));
  try {
    const workflow = await instantiateTemplate(auth.session.companyId, auth.session.userId, String(key ?? ""));
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
