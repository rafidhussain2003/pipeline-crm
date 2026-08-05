import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession, setPinUnlockCookie } from "@/lib/auth";
import { verifyPin, isValidPin } from "@/lib/auth/pin";
import { checkAccountLockout, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security/events";

// Unlock: verify the PIN and set the short-lived unlock cookie. Brute-force
// protected by the SAME per-account lockout login uses (5 failures → 15 min),
// which matters for a 4-digit secret.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = `pin:${session.userId}`;
  if (checkAccountLockout(key).locked) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const pin = body?.pin;

  const [u] = await db.select({ pinHash: users.pinHash }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (!u?.pinHash) return NextResponse.json({ error: "No PIN is set." }, { status: 400 });

  if (!isValidPin(pin) || !(await verifyPin(pin, u.pinHash))) {
    const { lockedNow } = recordLoginFailure(key);
    await recordSecurityEvent({ event: "pin.unlock_failed", riskLevel: lockedNow ? "high" : "low", companyId: session.companyId, userId: session.userId });
    if (lockedNow) {
      await recordSecurityEvent({ event: "account.locked", riskLevel: "high", companyId: session.companyId, userId: session.userId, reason: "pin brute-force" });
    }
    return NextResponse.json({ error: "Incorrect PIN." }, { status: 401 });
  }

  recordLoginSuccess(key);
  await setPinUnlockCookie(session.userId, session.sessionId);
  return NextResponse.json({ ok: true });
}
