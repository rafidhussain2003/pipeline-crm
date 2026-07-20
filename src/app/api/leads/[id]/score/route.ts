import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { canAccessLead } from "@/lib/leads/access";
import { scoreLead } from "@/lib/ai/lead-scoring";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  // Tenant + Agent Portal check: company always, own-leads-only for agents
  // (see lib/leads/access).
  if (!(await canAccessLead(auth.session, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const score = await scoreLead(id);
  if (!score) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ score });
}
