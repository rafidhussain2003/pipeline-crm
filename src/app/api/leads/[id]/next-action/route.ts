import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { canAccessLead } from "@/lib/leads/access";
import { recommendNextAction } from "@/lib/ai/next-best-action";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  // Agent Portal: agents reach only their own leads (see lib/leads/access).
  if (!(await canAccessLead(auth.session, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const recommendation = await recommendNextAction(id);
  if (!recommendation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ recommendation });
}
