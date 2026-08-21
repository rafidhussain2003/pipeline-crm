import crypto from "crypto";
import { db } from "@/db";
import { notepadNotes, companies } from "@/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { applyRetention, type SensitiveMeta } from "@/lib/notepad/detect";
import { encrypt, decrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

// Server-only Secure Notepad helpers shared by the API route, the cron route
// and the in-process hourly sweep — so the retention policy is enforced by ONE
// implementation everywhere.

// Keyed HMAC over a value's identity — the retention clock key. Uses
// ENCRYPTION_KEY so a low-entropy value (e.g. an SSN) can't be brute-forced
// from the stored meta.
export function metaHmac(v: string): string {
  return crypto.createHmac("sha256", process.env.ENCRYPTION_KEY || "notepad-dev-key").update(v).digest("hex");
}

// Decrypt stored content, tolerating legacy plaintext rows written before the
// encryption switch (decrypt throws on non-ciphertext → treat as plaintext).
export function readStored(raw: string): string {
  if (!raw) return "";
  try {
    return decrypt(raw);
  } catch {
    return raw;
  }
}

// The retention sweep: erase every note's sensitive values that are past their
// 12h / 7d window (DOB → birth year), keeping all normal text. Runs the SAME
// applyRetention the API uses, so the notepad GET (lazy, per-note) and this
// sweep (all idle notes) enforce one policy. Version-guarded, so a concurrent
// owner save is never overwritten; idempotent, so extra runs are harmless.
export async function sweepExpiredNotes(nowMs: number = Date.now()): Promise<{ scanned: number; notesSwept: number; expired: number; companies: number }> {
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
    const res = applyRetention(stored, prevMeta, nowMs, metaHmac);
    if (res.expired === 0 && res.content === stored) continue;
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

  return { scanned: rows.length, notesSwept, expired, companies: companiesTouched.size };
}
