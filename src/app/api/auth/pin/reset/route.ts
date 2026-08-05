import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession, setPinUnlockCookie } from "@/lib/auth";
import { hashPin, isValidPin } from "@/lib/auth/pin";
import { verifyCode } from "@/lib/auth/verification";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { recordSecurityEvent } from "@/lib/security/events";

// Verify the emailed code, then set a new PIN. Unlocks this session on success.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!checkPolicy("auth.password_reset", getClientIp(req)).allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { code, pin } = body || {};
  if (!isValidPin(pin)) return NextResponse.json({ error: "PIN must be exactly 4 digits." }, { status: 400 });
  if (typeof code !== "string" || !code.trim()) return NextResponse.json({ error: "Enter the code from your email." }, { status: 400 });

  const verified = await verifyCode({ email: session.email, purpose: "pin_reset", code });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 });

  await db.update(users).set({ pinHash: await hashPin(pin), pinUpdatedAt: new Date() }).where(eq(users.id, session.userId));
  await setPinUnlockCookie(session.userId, session.sessionId);
  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "user.pin_reset", entityType: "user", entityId: session.userId });
  await recordSecurityEvent({ event: "pin.reset", riskLevel: "medium", companyId: session.companyId, userId: session.userId });
  return NextResponse.json({ ok: true });
}
