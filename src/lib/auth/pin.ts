// Optional 4-digit login PIN — a SECOND unlock layer required only after ~1h of
// inactivity or a fresh login. It never replaces the password session: the
// session JWT + Remember-Me are untouched, and "unlocked" state lives entirely
// in a separate short-lived cookie (see setPinUnlockCookie in @/lib/auth).
import bcrypt from "bcryptjs";
import { getPinUnlockToken, verifyShortLived, type SessionPayload } from "@/lib/auth";

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

type PinUnlockClaims = { u: string; s: string | null; k: "pin" };

// True when this session currently holds a valid, unexpired PIN-unlock cookie.
// The token is bound to BOTH the user and the session id, so a rotated session
// (a fresh login, here or elsewhere) automatically invalidates any older unlock
// — which is exactly why a fresh login re-prompts for the PIN.
export async function isPinUnlocked(session: SessionPayload): Promise<boolean> {
  const token = await getPinUnlockToken();
  if (!token) return false;
  const claims = verifyShortLived<PinUnlockClaims>(token);
  if (!claims || claims.k !== "pin") return false;
  if (claims.u !== session.userId) return false;
  if ((claims.s ?? null) !== (session.sessionId ?? null)) return false;
  return true;
}
