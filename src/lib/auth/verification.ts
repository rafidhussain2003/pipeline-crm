// Phase 13 — email verification codes. A 6-digit code, stored hashed, with a
// 10-minute expiry, a 60-second resend cooldown, and capped resend + guess
// attempts. Used for signup (carrying the pending name/company) and password
// reset. The code itself is only ever emailed — never returned to the browser
// or stored in plaintext.
import { db } from "@/db";
import { emailVerifications } from "@/db/schema";
import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import crypto from "crypto";

export type VerificationPurpose = "signup" | "password_reset";

const CODE_TTL_MS = 10 * 60_000; // 10 minutes
const RESEND_COOLDOWN_MS = 60_000; // 60 seconds
const MAX_RESENDS = 5;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  // Uniformly random 6-digit code (100000–999999).
  return String(crypto.randomInt(100000, 1000000));
}
function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}
const norm = (email: string) => email.trim().toLowerCase();

// Housekeeping: drop this email+purpose's expired/consumed rows so only one
// live code exists at a time.
async function purge(email: string, purpose: VerificationPurpose): Promise<void> {
  await db.delete(emailVerifications).where(and(eq(emailVerifications.email, email), eq(emailVerifications.purpose, purpose), or(lt(emailVerifications.expiresAt, new Date()), isNotNull(emailVerifications.consumedAt))));
}

export type RequestResult =
  | { ok: true; code: string; expiresInSec: number; resend: boolean }
  | { ok: false; error: string; retryAfterSec?: number };

// Create or resend a code. Returns the plaintext code (for the caller to email)
// on success. Enforces the resend cooldown + max resends.
export async function requestCode(params: { email: string; purpose: VerificationPurpose; payload?: Record<string, unknown> }): Promise<RequestResult> {
  const email = norm(params.email);
  const now = Date.now();

  const [existing] = await db
    .select()
    .from(emailVerifications)
    .where(and(eq(emailVerifications.email, email), eq(emailVerifications.purpose, params.purpose)))
    .orderBy(emailVerifications.createdAt)
    .limit(1);

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(now + CODE_TTL_MS);

  if (existing && !existing.consumedAt && existing.expiresAt.getTime() > now) {
    // Live code exists → this is a resend. Enforce cooldown + cap.
    const sinceLast = now - existing.lastSentAt.getTime();
    if (sinceLast < RESEND_COOLDOWN_MS) {
      return { ok: false, error: "Please wait before requesting another code.", retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000) };
    }
    if (existing.resendCount + 1 > existing.maxResends) {
      return { ok: false, error: "Too many codes requested. Please start over in a little while." };
    }
    await db
      .update(emailVerifications)
      .set({ codeHash, expiresAt, attempts: 0, resendCount: existing.resendCount + 1, lastSentAt: new Date(), payload: params.payload ?? existing.payload })
      .where(eq(emailVerifications.id, existing.id));
    return { ok: true, code, expiresInSec: CODE_TTL_MS / 1000, resend: true };
  }

  // No live code — clean up any stale rows and create fresh.
  await purge(email, params.purpose);
  await db.insert(emailVerifications).values({ email, purpose: params.purpose, codeHash, payload: params.payload ?? null, expiresAt, maxAttempts: MAX_ATTEMPTS, maxResends: MAX_RESENDS, lastSentAt: new Date() });
  return { ok: true, code, expiresInSec: CODE_TTL_MS / 1000, resend: false };
}

export type VerifyResult = { ok: true; payload: Record<string, unknown> | null } | { ok: false; error: string };

// Verify a code. On success marks it consumed and returns the stored payload.
// `consume: false` checks the code WITHOUT consuming it (used to gate the
// password-reset "set new password" step so the same code proves both steps).
export async function verifyCode(params: { email: string; purpose: VerificationPurpose; code: string; consume?: boolean }): Promise<VerifyResult> {
  const email = norm(params.email);
  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(and(eq(emailVerifications.email, email), eq(emailVerifications.purpose, params.purpose)))
    .orderBy(emailVerifications.createdAt)
    .limit(1);

  if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "That code has expired. Please request a new one." };
  }
  if (row.attempts >= row.maxAttempts) {
    return { ok: false, error: "Too many incorrect attempts. Please request a new code." };
  }
  const matches = crypto.timingSafeEqual(Buffer.from(row.codeHash, "hex"), Buffer.from(hashCode(params.code.trim()), "hex"));
  if (!matches) {
    await db.update(emailVerifications).set({ attempts: row.attempts + 1 }).where(eq(emailVerifications.id, row.id));
    return { ok: false, error: "Incorrect code. Please try again." };
  }
  if (params.consume !== false) {
    await db.update(emailVerifications).set({ consumedAt: new Date() }).where(eq(emailVerifications.id, row.id));
  }
  return { ok: true, payload: (row.payload as Record<string, unknown> | null) ?? null };
}

export const VERIFICATION_LIMITS = { CODE_TTL_MS, RESEND_COOLDOWN_MS, MAX_RESENDS, MAX_ATTEMPTS };
