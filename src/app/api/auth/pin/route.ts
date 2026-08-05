import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession, setPinUnlockCookie, clearPinUnlockCookie } from "@/lib/auth";
import { hashPin, verifyPin, isValidPin } from "@/lib/auth/pin";
import { recordAudit } from "@/lib/audit";
import { recordSecurityEvent } from "@/lib/security/events";

// The caller's PIN status — whether they have one, and whether their company
// requires it (so the profile UI can hide "disable" when it's mandatory).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [u] = await db.select({ pinHash: users.pinHash }).from(users).where(eq(users.id, session.userId)).limit(1);
  let required = false;
  if (session.role === "agent" && session.companyId) {
    const [c] = await db.select({ req: companies.requireAgentPin }).from(companies).where(eq(companies.id, session.companyId)).limit(1);
    required = !!c?.req;
  }
  return NextResponse.json({ hasPin: !!u?.pinHash, required });
}

// Set or change the caller's own 4-digit PIN. First-time set needs only the
// authenticated session; changing an existing PIN requires the current PIN.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { pin, currentPin } = body || {};
  if (!isValidPin(pin)) return NextResponse.json({ error: "PIN must be exactly 4 digits." }, { status: 400 });

  const [u] = await db.select({ pinHash: users.pinHash }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const changing = !!u.pinHash;
  if (changing && (!isValidPin(currentPin) || !(await verifyPin(currentPin, u.pinHash!)))) {
    return NextResponse.json({ error: "Your current PIN is incorrect." }, { status: 403 });
  }

  await db.update(users).set({ pinHash: await hashPin(pin), pinUpdatedAt: new Date() }).where(eq(users.id, session.userId));
  // Setting/changing a PIN unlocks this session immediately.
  await setPinUnlockCookie(session.userId, session.sessionId);

  await recordAudit({ companyId: session.companyId, userId: session.userId, action: changing ? "user.pin_changed" : "user.pin_set", entityType: "user", entityId: session.userId });
  await recordSecurityEvent({ event: "pin.set", riskLevel: "low", companyId: session.companyId, userId: session.userId, reason: changing ? "changed" : "set" });
  return NextResponse.json({ ok: true });
}

// Disable the caller's PIN. Requires the current PIN; blocked for agents whose
// company requires one.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const currentPin = body?.currentPin;

  const [u] = await db.select({ pinHash: users.pinHash }).from(users).where(eq(users.id, session.userId)).limit(1);
  if (!u?.pinHash) return NextResponse.json({ ok: true }); // nothing to disable

  if (!isValidPin(currentPin) || !(await verifyPin(currentPin, u.pinHash))) {
    return NextResponse.json({ error: "Your current PIN is incorrect." }, { status: 403 });
  }

  if (session.role === "agent" && session.companyId) {
    const [c] = await db.select({ req: companies.requireAgentPin }).from(companies).where(eq(companies.id, session.companyId)).limit(1);
    if (c?.req) return NextResponse.json({ error: "Your company requires a login PIN, so it can't be removed." }, { status: 403 });
  }

  await db.update(users).set({ pinHash: null, pinUpdatedAt: new Date() }).where(eq(users.id, session.userId));
  await clearPinUnlockCookie();
  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "user.pin_disabled", entityType: "user", entityId: session.userId });
  return NextResponse.json({ ok: true });
}
