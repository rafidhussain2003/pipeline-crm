import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow } from "@/lib/workflow/guard";
import { listTriggers, listTriggersByModule } from "@/lib/workflow";

// The registered trigger catalog (grouped by module for the picker).
export async function GET(_req: NextRequest) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ triggers: listTriggers(), byModule: listTriggersByModule() });
}
