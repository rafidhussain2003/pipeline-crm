import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireCompanySession } from "@/lib/auth";
import { scoreLead } from "@/lib/ai/lead-scoring";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  // Tenant check: confirm this lead belongs to the caller's company before
  // scoring it, same pattern used for the lead sub-resource fixes earlier.
  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, auth.session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const score = await scoreLead(id);
  if (!score) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ score });
}
