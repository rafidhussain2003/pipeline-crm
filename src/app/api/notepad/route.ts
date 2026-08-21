import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notepadNotes } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { guardNotepad, MAX_TABS } from "@/lib/notepad/guard";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Secure Notepad — the TAB LIST for the signed-in agent. A user now has many
// notes (tabs); this route lists them (metadata only, no content) and creates
// new ones. Per-tab content lives at /api/notepad/[id]. Every query is scoped
// to the session's companyId + userId, so a user only ever sees their own tabs.

function tabTitle(raw: unknown, fallback: string): string {
  const t = typeof raw === "string" ? raw.trim().replace(/[\r\n]+/g, " ").slice(0, 200) : "";
  return t || fallback;
}

export async function GET() {
  const auth = await guardNotepad();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let tabs = await db
    .select({ id: notepadNotes.id, title: notepadNotes.title, position: notepadNotes.position, updatedAt: notepadNotes.updatedAt })
    .from(notepadNotes)
    .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
    .orderBy(asc(notepadNotes.position), asc(notepadNotes.createdAt));

  if (tabs.length === 0) {
    // First open (or a brand-new user) → seed one empty tab.
    await db.insert(notepadNotes).values({ companyId: session.companyId, userId: session.userId, title: "Note 1", position: 0 });
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.created", entityType: "notepad_note" });
    tabs = await db
      .select({ id: notepadNotes.id, title: notepadNotes.title, position: notepadNotes.position, updatedAt: notepadNotes.updatedAt })
      .from(notepadNotes)
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
      .orderBy(asc(notepadNotes.position), asc(notepadNotes.createdAt));
  }

  return NextResponse.json({ tabs }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await guardNotepad();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notepadNotes)
    .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)));
  if (count >= MAX_TABS) {
    return NextResponse.json({ error: `You can keep up to ${MAX_TABS} tabs. Close one to add another.` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const title = tabTitle(body?.title, `Note ${count + 1}`);
  const [{ maxPos } = { maxPos: -1 }] = await db
    .select({ maxPos: sql<number>`coalesce(max(${notepadNotes.position}), -1)::int` })
    .from(notepadNotes)
    .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)));

  const [tab] = await db
    .insert(notepadNotes)
    .values({ companyId: session.companyId, userId: session.userId, title, position: maxPos + 1, content: "" })
    .returning({ id: notepadNotes.id, title: notepadNotes.title, position: notepadNotes.position, updatedAt: notepadNotes.updatedAt });

  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.created", entityType: "notepad_note", entityId: tab.id });
  return NextResponse.json({ tab }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
