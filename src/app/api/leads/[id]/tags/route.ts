import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadTags, leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db.select().from(leadTags).where(eq(leadTags.leadId, id));
  return NextResponse.json({ tagIds: rows.map((r) => r.tagId) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { tagId } = await req.json();
  if (!tagId) return NextResponse.json({ error: "tagId is required" }, { status: 400 });

  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.insert(leadTags).values({ leadId: id, tagId }).onConflictDoNothing();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const tagId = searchParams.get("tagId");
  if (!tagId) return NextResponse.json({ error: "tagId is required" }, { status: 400 });

  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(leadTags).where(and(eq(leadTags.leadId, id), eq(leadTags.tagId, tagId)));
  return NextResponse.json({ ok: true });
}
