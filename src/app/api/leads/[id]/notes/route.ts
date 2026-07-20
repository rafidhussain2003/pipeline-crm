import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadNotes, users } from "@/db/schema";
import { getSession, type CompanySession } from "@/lib/auth";
import { canAccessLead } from "@/lib/leads/access";
import { isUuid } from "@/lib/url";
import { desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // A malformed id would otherwise reach a uuid column and surface as an
  // empty-bodied 500; treat it as the missing record it describes.
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Agent Portal: agents reach only their own leads (see lib/leads/access).
  if (!(await canAccessLead(session as CompanySession, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
  // A malformed id would otherwise reach a uuid column and surface as an
  // empty-bodied 500; treat it as the missing record it describes.
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { body } = await req.json();
  if (!body?.trim()) return NextResponse.json({ error: "Note body is required" }, { status: 400 });

  // Agent Portal: agents reach only their own leads (see lib/leads/access).
  if (!(await canAccessLead(session as CompanySession, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
