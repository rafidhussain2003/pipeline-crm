import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow, workflowErrorResponse } from "@/lib/workflow/guard";
import { triggerWorkflowManually } from "@/lib/workflow";

// Manual trigger — runs the workflow once with an optional test payload.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflow("workflow:run");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const input = b?.input && typeof b.input === "object" ? b.input : {};
  try {
    const result = await triggerWorkflowManually(auth.session.companyId, auth.session.userId, id, input);
    return NextResponse.json({ result });
  } catch (err) {
    return workflowErrorResponse(err);
  }
}
