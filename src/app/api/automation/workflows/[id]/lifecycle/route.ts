import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { publishWorkflow, disableWorkflow, archiveWorkflow, duplicateWorkflow } from "@/lib/workflow";

// One endpoint for the builder's lifecycle buttons: publish / disable / archive
// / duplicate. Each returns the resulting workflow (duplicate returns the copy).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflow("workflow:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { op } = await req.json().catch(() => ({ op: "" }));
  const { companyId, userId } = auth.session;
  try {
    let workflow;
    switch (op) {
      case "publish": workflow = await publishWorkflow(companyId, userId, id); break;
      case "disable": workflow = await disableWorkflow(companyId, userId, id); break;
      case "archive": workflow = await archiveWorkflow(companyId, userId, id); break;
      case "duplicate": workflow = await duplicateWorkflow(companyId, userId, id); break;
      default: return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
    }
    return NextResponse.json({ workflow });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
