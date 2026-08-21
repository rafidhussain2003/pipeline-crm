import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { notepadNotes, companies } from "@/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { applyRetention, type SensitiveMeta } from "@/lib/notepad/detect";
import { encrypt, decrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

// Secure Notepad — the retention sweep. Sensitive values are kept readable for
// 12 hours after typing, then auto-erased (DOB keeps its birth year). The
// notepad GET runs this lazily for a note the owner opens; THIS sweep catches
// notes nobody opened, so a value can't outlive its 12h window on an idle note.
//
// Schedule it HOURLY (not weekly) — the retention window is 12h, so the sweep
// must run well inside it. It is safe to run as often as you like: a note with
// nothing expired is a no-op, and re-runs are idempotent.
// Authenticated by the same x-cron-secret as every other cron route, compared
// in constant time.
function cronSecretValid(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
function metaHmac(v: string): string {
  return crypto.createHmac("sha256", process.env.ENCRYPTION_KEY || "notepad-dev-key").update(v).digest("hex");
}
function readStored(raw: string): string {
  if (!raw) return "";
  try {
    return decrypt(raw);
  } catch {
    return raw;
  }
}

export async function POST(req: NextRequest) {
  if (!cronSecretValid(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  // Only notes that actually track a sensitive value can have anything to
  // expire — the meta column is the efficient prefilter.
  const rows = await db
    .select({ id: notepadNotes.id, companyId: notepadNotes.companyId, content: notepadNotes.content, meta: notepadNotes.sensitiveMeta, version: notepadNotes.version })
    .from(notepadNotes)
    .where(isNotNull(notepadNotes.sensitiveMeta));

  let notesSwept = 0;
  let expired = 0;
  const companiesTouched = new Set<string>();
  for (const n of rows) {
    const prevMeta = (n.meta ?? {}) as SensitiveMeta;
    if (Object.keys(prevMeta).length === 0) continue;
    const stored = readStored(n.content);
    const res = applyRetention(stored, prevMeta, now, metaHmac);
    if (res.expired === 0 && res.content === stored) continue;
    // Version-guarded so a concurrent owner save is never overwritten.
    const [applied] = await db
      .update(notepadNotes)
      .set({ content: encrypt(res.content), sensitiveMeta: res.meta, version: sql`${notepadNotes.version} + 1`, updatedAt: new Date() })
      .where(and(eq(notepadNotes.id, n.id), eq(notepadNotes.version, n.version)))
      .returning({ id: notepadNotes.id });
    if (!applied) continue; // the owner wrote first; their save already applied retention
    notesSwept++;
    expired += res.expired;
    companiesTouched.add(n.companyId);
    if (res.expired > 0) {
      await recordAudit({ companyId: n.companyId, userId: null, action: "notepad.sensitive_expired", entityType: "notepad_note", entityId: n.id, metadata: { expired: res.expired, trigger: "sweep" } });
    }
  }

  // Stamp every enabled company so the admin's settings card shows the sweep ran.
  await db.update(companies).set({ notepadCleanupAt: new Date() }).where(eq(companies.notepadEnabled, true));

  return NextResponse.json({ ok: true, scanned: rows.length, notesSwept, expired, companies: companiesTouched.size });
}
