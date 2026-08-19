import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notepadNotes, companies } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireCompanySession } from "@/lib/auth";
import { redactSensitive, removeExpiredPlaceholders, NOTE_MAX_CHARS } from "@/lib/notepad/detect";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Secure Notepad — "my note" only. There is deliberately NO note id anywhere
// (no URL param, no body id): every query is companyId + userId from the
// verified session, so there is no IDOR surface at all — a tampered request
// can only ever reach the caller's own note. Admins do NOT see agents' notes;
// each person has exactly one private note.
//
// SERVER-SIDE ENFORCEMENT: every save runs the same detection/redaction the
// client previews, on the raw body — a modified client, a direct POST, or a
// crafted payload still gets sanitized before anything is stored. The
// original sensitive values are never stored, logged, audited or echoed
// beyond this response's sanitized content.
const ALLOWED_ROLES = new Set(["admin", "manager", "agent", "backend_agent"]);

async function guard() {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!ALLOWED_ROLES.has(auth.session.role)) {
    return { ok: false as const, response: NextResponse.json({ error: "You do not have access to the Secure Notepad." }, { status: 403 }) };
  }
  const [co] = await db
    .select({ enabled: companies.notepadEnabled })
    .from(companies)
    .where(eq(companies.id, auth.session.companyId))
    .limit(1);
  if (co && co.enabled === false) {
    return { ok: false as const, response: NextResponse.json({ error: "Secure Notepad is disabled for your company." }, { status: 403 }) };
  }
  return auth;
}

export async function GET() {
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  let [note] = await db
    .select({ content: notepadNotes.content, version: notepadNotes.version, updatedAt: notepadNotes.updatedAt })
    .from(notepadNotes)
    .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
    .limit(1);

  if (!note) {
    // First open → create the empty note (idempotent under races).
    await db
      .insert(notepadNotes)
      .values({ companyId: session.companyId, userId: session.userId, content: "" })
      .onConflictDoNothing();
    [note] = await db
      .select({ content: notepadNotes.content, version: notepadNotes.version, updatedAt: notepadNotes.updatedAt })
      .from(notepadNotes)
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
      .limit(1);
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.created", entityType: "notepad_note" });
  }

  // Lazy expiry sweep for THIS note (belt-and-braces alongside the Friday
  // cron): expired placeholders never survive a load even if the cron is down.
  const swept = removeExpiredPlaceholders(note.content);
  if (swept.removed > 0) {
    await db
      .update(notepadNotes)
      .set({ content: swept.content, version: sql`${notepadNotes.version} + 1`, updatedAt: new Date() })
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)));
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "notepad.sensitive_purged",
      entityType: "notepad_note",
      metadata: { removed: swept.removed, trigger: "on_load" },
    });
    const [fresh] = await db
      .select({ content: notepadNotes.content, version: notepadNotes.version, updatedAt: notepadNotes.updatedAt })
      .from(notepadNotes)
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
      .limit(1);
    note = fresh;
  }

  return NextResponse.json({ content: note.content, version: note.version, updatedAt: note.updatedAt }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const raw = typeof body?.content === "string" ? body.content : null;
  const version = Number.isInteger(body?.version) ? (body.version as number) : null;
  if (raw === null || version === null) return NextResponse.json({ error: "content and version are required." }, { status: 400 });
  if (raw.length > NOTE_MAX_CHARS) {
    return NextResponse.json({ error: "This note is too large. Split it into smaller notes." }, { status: 413 });
  }

  // THE security step — always server-side, on the raw payload.
  const { sanitized, detections } = redactSensitive(raw);

  // Optimistic concurrency: the save applies only if the caller edited the
  // version they last saw; a stale save (another tab won the race) gets a 409
  // WITH the current server copy so the client can reconcile without losing
  // the newer content.
  const [updated] = await db
    .update(notepadNotes)
    .set({
      content: sanitized,
      version: sql`${notepadNotes.version} + 1`,
      ...(detections.length > 0 ? { redactionCount: sql`${notepadNotes.redactionCount} + ${detections.length}` } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId), eq(notepadNotes.version, version)))
    .returning({ version: notepadNotes.version, updatedAt: notepadNotes.updatedAt });

  if (!updated) {
    const [current] = await db
      .select({ content: notepadNotes.content, version: notepadNotes.version })
      .from(notepadNotes)
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
      .limit(1);
    if (!current) return NextResponse.json({ error: "Note not found — reload the page." }, { status: 404 });
    return NextResponse.json({ error: "This note changed in another tab.", content: current.content, version: current.version }, { status: 409 });
  }

  // Audit counts/kinds only — NEVER values.
  if (detections.length > 0) {
    const kinds = detections.reduce<Record<string, number>>((acc, d) => ((acc[d.kind] = (acc[d.kind] || 0) + 1), acc), {});
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "notepad.sensitive_protected",
      entityType: "notepad_note",
      metadata: { count: detections.length, kinds },
    });
  }

  return NextResponse.json(
    { content: sanitized, version: updated.version, updatedAt: updated.updatedAt, redactions: detections.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
