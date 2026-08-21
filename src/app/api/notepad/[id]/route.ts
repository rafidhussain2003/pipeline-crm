import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notepadNotes } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { guardNotepad } from "@/lib/notepad/guard";
import { applyRetention, NOTE_MAX_CHARS, type SensitiveMeta } from "@/lib/notepad/detect";
import { metaHmac, readStored } from "@/lib/notepad/server";
import { encrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { isUuid } from "@/lib/url";

// Secure Notepad — a single TAB's content. The tab id appears in the URL, but
// every query is scoped to companyId + userId + id from the verified session,
// so a tampered / guessed / another-user's id can only ever return 404 — no
// IDOR. Retention (12h/7d/Active, DOB→birth year) is applied on read and save;
// values are stored encrypted at rest and returned only to the owning agent.
const metaChanged = (a: SensitiveMeta, b: SensitiveMeta) => JSON.stringify(a) !== JSON.stringify(b);

// GET — one tab's content (retention applied).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardNotepad();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [note] = await db
    .select({ title: notepadNotes.title, content: notepadNotes.content, meta: notepadNotes.sensitiveMeta, version: notepadNotes.version, updatedAt: notepadNotes.updatedAt })
    .from(notepadNotes)
    .where(and(eq(notepadNotes.id, id), eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
    .limit(1);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stored = readStored(note.content);
  const prevMeta = (note.meta ?? {}) as SensitiveMeta;
  const res = applyRetention(stored, prevMeta, Date.now(), metaHmac);

  let version = note.version;
  let content = res.content;
  if (res.content !== stored || metaChanged(prevMeta, res.meta)) {
    const [applied] = await db
      .update(notepadNotes)
      .set({ content: encrypt(res.content), sensitiveMeta: res.meta, version: sql`${notepadNotes.version} + 1`, updatedAt: new Date() })
      .where(and(eq(notepadNotes.id, id), eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId), eq(notepadNotes.version, note.version)))
      .returning({ version: notepadNotes.version });
    if (applied) {
      version = applied.version;
      if (res.expired > 0) await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.sensitive_expired", entityType: "notepad_note", entityId: id, metadata: { expired: res.expired, trigger: "on_load" } });
    } else {
      // A concurrent write won — return the committed copy.
      const [fresh] = await db
        .select({ content: notepadNotes.content, version: notepadNotes.version })
        .from(notepadNotes)
        .where(and(eq(notepadNotes.id, id), eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
        .limit(1);
      if (fresh) {
        content = readStored(fresh.content);
        version = fresh.version;
      }
    }
  }

  return NextResponse.json({ id, title: note.title, content, version, updatedAt: note.updatedAt }, { headers: { "Cache-Control": "no-store" } });
}

// PUT — save a tab's content (retention applied, optimistic concurrency).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardNotepad();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const declaredLen = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLen) && declaredLen > 8_000_000) {
    return NextResponse.json({ error: "This note is too large. Split it into smaller notes." }, { status: 413 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = typeof body?.content === "string" ? body.content : null;
  const version = Number.isInteger(body?.version) ? (body.version as number) : null;
  if (raw === null || version === null) return NextResponse.json({ error: "content and version are required." }, { status: 400 });
  if (raw.length > NOTE_MAX_CHARS) return NextResponse.json({ error: "This note is too large. Split it into smaller notes." }, { status: 413 });

  const [existing] = await db
    .select({ meta: notepadNotes.sensitiveMeta })
    .from(notepadNotes)
    .where(and(eq(notepadNotes.id, id), eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const prevMeta = (existing.meta ?? {}) as SensitiveMeta;

  const res = applyRetention(raw, prevMeta, Date.now(), metaHmac);

  const [updated] = await db
    .update(notepadNotes)
    .set({ content: encrypt(res.content), sensitiveMeta: res.meta, version: sql`${notepadNotes.version} + 1`, updatedAt: new Date() })
    .where(and(eq(notepadNotes.id, id), eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId), eq(notepadNotes.version, version)))
    .returning({ version: notepadNotes.version, updatedAt: notepadNotes.updatedAt });

  if (!updated) {
    const [current] = await db
      .select({ content: notepadNotes.content, version: notepadNotes.version })
      .from(notepadNotes)
      .where(and(eq(notepadNotes.id, id), eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
      .limit(1);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "This note changed in another tab.", content: readStored(current.content), version: current.version }, { status: 409 });
  }

  if (res.detected.length > 0) {
    const kinds = res.detected.reduce<Record<string, number>>((acc: Record<string, number>, d: { kind: string }) => ((acc[d.kind] = (acc[d.kind] || 0) + 1), acc), {});
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.sensitive_detected", entityType: "notepad_note", entityId: id, metadata: { count: res.detected.length, kinds } });
  }
  if (res.expired > 0) {
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.sensitive_expired", entityType: "notepad_note", entityId: id, metadata: { expired: res.expired, trigger: "on_save" } });
  }

  return NextResponse.json({ content: res.content, version: updated.version, updatedAt: updated.updatedAt, detected: res.detected.length, expired: res.expired }, { headers: { "Cache-Control": "no-store" } });
}

// PATCH — rename a tab.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardNotepad();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim().replace(/[\r\n]+/g, " ").slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "A tab name is required." }, { status: 400 });

  const [updated] = await db
    .update(notepadNotes)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(notepadNotes.id, id), eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
    .returning({ id: notepadNotes.id, title: notepadNotes.title });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, title: updated.title });
}

// DELETE — close (permanently delete) a tab. The client re-seeds a fresh tab if
// the last one is removed (via the GET list route).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardNotepad();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [deleted] = await db
    .delete(notepadNotes)
    .where(and(eq(notepadNotes.id, id), eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
    .returning({ id: notepadNotes.id });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.deleted", entityType: "notepad_note", entityId: id });
  return NextResponse.json({ ok: true });
}
