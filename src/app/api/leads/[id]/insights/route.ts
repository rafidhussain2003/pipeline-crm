import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeadInsights } from "@/lib/insights";

// Lead AI Insights (Phase 9) — powers the one AI Insights card on the Lead
// Details page. Company-scoped: getLeadInsights returns null if the lead isn't
// in this company. Reads the cached insight and recomputes transparently if the
// lead changed since it was last computed, so the card is always current. This
// endpoint never mutates lead data and never touches the assignment engine.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const result = await getLeadInsights(id, session.companyId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(result);
}
