import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadNotes, users } from "@/db/schema";
import { getSession, type CompanySession } from "@/lib/auth";
import { canAccessLead } from "@/lib/leads/access";
import { isUuid } from "@/lib/url";
import { and, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { eventBus } from "@/lib/events/bus";
import { hasPermission } from "@/lib/permissions";

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
    .select({
      id: leadNotes.id,
      body: leadNotes.body,
      createdAt: leadNotes.createdAt,
      editedAt: leadNotes.editedAt,
      authorId: leadNotes.authorId,
      authorName: users.name,
    })
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

  // Lead Workspace realtime: colleagues with this lead open see the note
  // appear without refreshing (forwarded to the SSE stream by the hub).
  await eventBus.emit("lead.updated", { leadId: id, companyId: session.companyId, changedFields: ["notes"] });

  return NextResponse.json({ note });
}

// Edit a note (Lead Workspace). Author-only — except admins, who can correct
// anyone's note. createdAt stays untouched; editedAt drives the "Edited"
// indicator, and the change is audited with the before/after bodies.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { noteId, body } = await req.json();
  if (typeof noteId !== "string" || !isUuid(noteId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (typeof body !== "string" || !body.trim()) return NextResponse.json({ error: "Note body is required" }, { status: 400 });

  // Agent Portal: agents reach only their own leads (see lib/leads/access).
  if (!(await canAccessLead(session as CompanySession, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [existing] = await db
    .select({ id: leadNotes.id, authorId: leadNotes.authorId, body: leadNotes.body })
    .from(leadNotes)
    .where(and(eq(leadNotes.id, noteId), eq(leadNotes.leadId, id)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (existing.authorId !== session.userId && !hasPermission(session.role, "leads:supervise")) {
    return NextResponse.json({ error: "You can only edit your own notes." }, { status: 403 });
  }

  const [note] = await db
    .update(leadNotes)
    .set({ body: body.trim(), editedAt: new Date() })
    .where(eq(leadNotes.id, noteId))
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "lead.note_edited",
    entityType: "lead",
    entityId: id,
    before: { body: existing.body },
    after: { body: note.body },
    metadata: { noteId },
  });

  await eventBus.emit("lead.updated", { leadId: id, companyId: session.companyId, changedFields: ["notes"] });

  return NextResponse.json({ note });
}
