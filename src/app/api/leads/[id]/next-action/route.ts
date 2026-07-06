import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireCompanySession } from "@/lib/auth";
import { recommendNextAction } from "@/lib/ai/next-best-action";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, auth.session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const recommendation = await recommendNextAction(id);
  if (!recommendation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ recommendation });
}
