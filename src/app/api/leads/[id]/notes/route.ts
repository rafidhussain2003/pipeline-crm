import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadNotes, leads, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({ id: leadNotes.id, body: leadNotes.body, createdAt: leadNotes.createdAt, authorName: users.name })
    .from(leadNotes)
    .leftJoin(users, eq(leadNotes.authorId, users.id))
    .where(eq(leadNotes.leadId, id))
    .orderBy(desc(leadNotes.createdAt));

  return NextResponse.json({ notes: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "Note body is required" }, { status: 400 });

  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [note] = await db.insert(leadNotes).values({ leadId: id, authorId: session.userId, body }).returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "lead.note_added",
    entityType: "lead",
    entityId: id,
  });

  return NextResponse.json({ note });
}
