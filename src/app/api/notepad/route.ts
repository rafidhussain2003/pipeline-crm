import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { notepadNotes, companies } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireCompanySession } from "@/lib/auth";
import { applyRetention, NOTE_MAX_CHARS, type SensitiveMeta } from "@/lib/notepad/detect";
import { encrypt, decrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Secure Notepad — "my note" only. There is deliberately NO note id anywhere
// (no URL param, no body id): every query is companyId + userId from the
// verified session, so there is no IDOR surface at all. Admins do NOT see
// agents' notes; each person has exactly one private note.
//
// RETENTION MODEL (owner rule): detected sensitive values (card / SSN / DOB /
// license-ID / bank) are kept READABLE so the agent can work the order, then
// auto-erased 12h after first typed (DOB keeps its birth year). The value is
// stored ENCRYPTED at rest (AES-256-GCM); the readable form is returned ONLY
// to the owning agent and is never logged or audited (counts/kinds only). The
// per-value clock lives in sensitive_meta (HMAC keys — no value).
const ALLOWED_ROLES = new Set(["admin", "manager", "agent", "backend_agent"]);

// Keyed HMAC over a value's identity — the retention clock key. Uses
// ENCRYPTION_KEY so a low-entropy value (e.g. an SSN) can't be brute-forced
// from the stored meta.
function metaHmac(v: string): string {
  return crypto.createHmac("sha256", process.env.ENCRYPTION_KEY || "notepad-dev-key").update(v).digest("hex");
}
// Decrypt stored content, tolerating legacy plaintext rows written before the
// encryption switch (decrypt throws on non-ciphertext → treat as plaintext).
function readStored(raw: string): string {
  if (!raw) return "";
  try {
    return decrypt(raw);
  } catch {
    return raw;
  }
}
const metaChanged = (a: SensitiveMeta, b: SensitiveMeta) => JSON.stringify(a) !== JSON.stringify(b);

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

  // GET is not read-only (it creates the note on first open and runs the
  // retention sweep), so it carries the same per-user rate limit as PUT.
  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  let [note] = await db
    .select({ content: notepadNotes.content, meta: notepadNotes.sensitiveMeta, version: notepadNotes.version, updatedAt: notepadNotes.updatedAt })
    .from(notepadNotes)
    .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
    .limit(1);

  if (!note) {
    await db.insert(notepadNotes).values({ companyId: session.companyId, userId: session.userId, content: "" }).onConflictDoNothing();
    [note] = await db
      .select({ content: notepadNotes.content, meta: notepadNotes.sensitiveMeta, version: notepadNotes.version, updatedAt: notepadNotes.updatedAt })
      .from(notepadNotes)
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
      .limit(1);
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.created", entityType: "notepad_note" });
  }

  const stored = readStored(note.content);
  const prevMeta = (note.meta ?? {}) as SensitiveMeta;
  const res = applyRetention(stored, prevMeta, Date.now(), metaHmac);

  // Persist if the retention pass changed anything (values expired, or the
  // clock map moved). Version-guarded so a concurrent PUT is never clobbered.
  if (res.content !== stored || metaChanged(prevMeta, res.meta)) {
    const [applied] = await db
      .update(notepadNotes)
      .set({ content: encrypt(res.content), sensitiveMeta: res.meta, version: sql`${notepadNotes.version} + 1`, updatedAt: new Date() })
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId), eq(notepadNotes.version, note.version)))
      .returning({ version: notepadNotes.version, updatedAt: notepadNotes.updatedAt });
    if (applied) {
      if (res.expired > 0) {
        await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.sensitive_expired", entityType: "notepad_note", metadata: { expired: res.expired, trigger: "on_load" } });
      }
      return NextResponse.json({ content: res.content, version: applied.version, updatedAt: applied.updatedAt }, { headers: { "Cache-Control": "no-store" } });
    }
    // A concurrent writer won — return the freshly committed state instead.
    const [fresh] = await db
      .select({ content: notepadNotes.content, version: notepadNotes.version, updatedAt: notepadNotes.updatedAt })
      .from(notepadNotes)
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
      .limit(1);
    if (fresh) return NextResponse.json({ content: readStored(fresh.content), version: fresh.version, updatedAt: fresh.updatedAt }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ content: res.content, version: note.version, updatedAt: note.updatedAt }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const auth = await guard();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  // Early size guard — reject an oversized payload before buffering the body.
  const declaredLen = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLen) && declaredLen > 8_000_000) {
    return NextResponse.json({ error: "This note is too large. Split it into smaller notes." }, { status: 413 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = typeof body?.content === "string" ? body.content : null;
  const version = Number.isInteger(body?.version) ? (body.version as number) : null;
  if (raw === null || version === null) return NextResponse.json({ error: "content and version are required." }, { status: 400 });
  if (raw.length > NOTE_MAX_CHARS) {
    return NextResponse.json({ error: "This note is too large. Split it into smaller notes." }, { status: 413 });
  }

  // Load the current retention clock so a value's 12h timer carries over
  // instead of resetting on every save.
  const [existing] = await db
    .select({ meta: notepadNotes.sensitiveMeta })
    .from(notepadNotes)
    .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
    .limit(1);
  const prevMeta = (existing?.meta ?? {}) as SensitiveMeta;

  // THE retention step — always server-side, on the raw payload.
  const res = applyRetention(raw, prevMeta, Date.now(), metaHmac);

  // Optimistic concurrency: applies only against the version the caller last
  // saw; a stale save gets a 409 WITH the current copy to reconcile.
  const [updated] = await db
    .update(notepadNotes)
    .set({ content: encrypt(res.content), sensitiveMeta: res.meta, version: sql`${notepadNotes.version} + 1`, updatedAt: new Date() })
    .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId), eq(notepadNotes.version, version)))
    .returning({ version: notepadNotes.version, updatedAt: notepadNotes.updatedAt });

  if (!updated) {
    const [current] = await db
      .select({ content: notepadNotes.content, version: notepadNotes.version })
      .from(notepadNotes)
      .where(and(eq(notepadNotes.companyId, session.companyId), eq(notepadNotes.userId, session.userId)))
      .limit(1);
    if (!current) return NextResponse.json({ error: "Note not found — reload the page." }, { status: 404 });
    return NextResponse.json({ error: "This note changed in another tab.", content: readStored(current.content), version: current.version }, { status: 409 });
  }

  // Audit counts/kinds only — NEVER values.
  if (res.detected.length > 0) {
    const kinds = res.detected.reduce<Record<string, number>>((acc: Record<string, number>, d: { kind: string }) => ((acc[d.kind] = (acc[d.kind] || 0) + 1), acc), {});
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.sensitive_detected", entityType: "notepad_note", metadata: { count: res.detected.length, kinds } });
  }
  if (res.expired > 0) {
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "notepad.sensitive_expired", entityType: "notepad_note", metadata: { expired: res.expired, trigger: "on_save" } });
  }

  return NextResponse.json(
    { content: res.content, version: updated.version, updatedAt: updated.updatedAt, detected: res.detected.length, expired: res.expired },
    { headers: { "Cache-Control": "no-store" } }
  );
}
