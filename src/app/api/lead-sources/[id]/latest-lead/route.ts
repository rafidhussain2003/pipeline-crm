import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, gt, isNull, desc } from "drizzle-orm";

// Backs the "Test Lead" verification flow — the connector page polls this
// after sending the customer to Meta's Lead Ads Testing Tool, passing back
// the timestamp it was clicked so a lead that already existed before the
// test isn't mistaken for the test lead arriving.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const since = req.nextUrl.searchParams.get("since");
  const sinceDate = since ? new Date(since) : null;
  if (!sinceDate || isNaN(sinceDate.getTime())) {
    return NextResponse.json({ error: "'since' query param must be a valid ISO timestamp" }, { status: 400 });
  }

  const [source] = await db
    .select({ id: leadSources.id })
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [lead] = await db
    .select({ id: leads.id, name: leads.name, createdAt: leads.createdAt })
    .from(leads)
    .where(and(eq(leads.sourceId, id), isNull(leads.deletedAt), gt(leads.createdAt, sinceDate)))
    .orderBy(desc(leads.createdAt))
    .limit(1);

  return NextResponse.json({ found: !!lead, lead: lead ?? null });
}
