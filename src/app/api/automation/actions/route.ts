import { NextRequest, NextResponse } from "next/server";
import { requireWorkflow } from "@/lib/workflow/guard";
import { listActions } from "@/lib/workflow";

// The registered action catalog (metadata only — run handlers stay server-side).
export async function GET(_req: NextRequest) {
  const auth = await requireWorkflow("workflow:view");
  if (!auth.ok) return auth.response;
  const actions = listActions().map((a) => ({
    key: a.key, label: a.label, description: a.description, category: a.category,
    recordsIntent: !!a.recordsIntent, placeholder: !!a.placeholder, configFields: a.configFields ?? [],
  }));
  return NextResponse.json({ actions });
}
