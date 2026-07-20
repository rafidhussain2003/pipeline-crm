import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, hashPassword, setSessionCookie, setRefreshCookie } from "@/lib/auth";
import { verifyCode } from "@/lib/auth/verification";
import { findCompanyAdministrator } from "@/lib/companies/administrator";
import { activateSession } from "@/lib/auth/session-registry";
import { issueRefreshToken, revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { and, eq, ne } from "drizzle-orm";

// Enterprise Agent Portal — step 2 of the administrator-approval workflow.
// The agent enters the code their administrator relayed; the code was only
// ever emailed to the administrator, so a valid code IS the approval. The
// stored payload pins which agent the code was issued for (and, for email
// changes, the exact address the administrator saw) — a code can never be
// replayed by or for anyone else.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "agent") {
    return NextResponse.json({ error: "Only agents use the approval workflow." }, { status: 400 });
  }

  const rl = checkPolicy("auth.password_change", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many attempts. Please wait a minute and try again." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const type = body.type === "email" || body.type === "password" ? (body.type as "email" | "password") : null;
  if (!type) return NextResponse.json({ error: "type must be \"email\" or \"password\"." }, { status: 400 });
  if (typeof body.code !== "string" || !body.code.trim()) {
    return NextResponse.json({ error: "The verification code from your administrator is required." }, { status: 400 });
  }

  const admin = await findCompanyAdministrator(session.companyId);
  if (!admin) return NextResponse.json({ error: "No active administrator found for your company." }, { status: 400 });

  const purpose = type === "email" ? ("agent_email_change" as const) : ("agent_password_change" as const);
  const verified = await verifyCode({ email: admin.email, purpose, code: body.code });
  if (!verified.ok) {
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "account.change_request_failed",
      entityType: "user",
      entityId: session.userId,
      metadata: { type, reason: "bad_code" },
    });
    return NextResponse.json({ error: verified.error }, { status: 401 });
  }
  if (!verified.payload || verified.payload.userId !== session.userId) {
    // Code was issued for a different agent's request — consumed but useless.
    return NextResponse.json({ error: "This code was not issued for your request. Ask your administrator to start again." }, { status: 403 });
  }

  const [me] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!me) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  if (type === "email") {
    // The administrator approved a SPECIFIC address (it was in their email);
    // that stored address is what gets applied — not whatever the completion
    // call happens to carry.
    const newEmail = typeof verified.payload.newEmail === "string" ? verified.payload.newEmail : null;
    if (!newEmail) return NextResponse.json({ error: "This code carries no approved email. Start a new request." }, { status: 400 });
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, newEmail), ne(users.id, session.userId)))
      .limit(1);
    if (existing) return NextResponse.json({ error: "That email is now in use by another account. Start a new request." }, { status: 409 });

    await db.update(users).set({ email: newEmail }).where(eq(users.id, session.userId));

    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "account.email_changed",
      entityType: "user",
      entityId: session.userId,
      before: { email: me.email },
      after: { email: newEmail },
      metadata: { via: "admin_approval", adminUserId: admin.id },
    });

    // Refresh the session cookie so its email claim matches the account.
    const sessionId = await activateSession(session.userId);
    await setSessionCookie({ userId: me.id, companyId: me.companyId, role: me.role, email: newEmail, sessionId });
    await revokeAllRefreshTokensForUser(me.id);
    const { rawToken, expiresAt } = await issueRefreshToken(me.id, req.headers.get("user-agent") || undefined);
    await setRefreshCookie(rawToken, expiresAt);

    return NextResponse.json({ ok: true, message: "Your login email has been changed." });
  }

  // type === "password" — the administrator approves the CHANGE; the new
  // password itself never leaves the agent.
  if (typeof body.newPassword !== "string" || body.newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }
  const passwordHash = await hashPassword(body.newPassword);
  await db
    .update(users)
    .set({ passwordHash, passwordChangedAt: new Date(), mustChangePassword: false })
    .where(eq(users.id, session.userId));

  // Single-device discipline on a credential change: everything else dies,
  // THIS device stays signed in on a freshly rotated session.
  await revokeAllRefreshTokensForUser(me.id);
  const sessionId = await activateSession(me.id);
  await setSessionCookie({ userId: me.id, companyId: me.companyId, role: me.role, email: me.email, sessionId });
  const { rawToken, expiresAt } = await issueRefreshToken(me.id, req.headers.get("user-agent") || undefined);
  await setRefreshCookie(rawToken, expiresAt);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "account.password_changed",
    entityType: "user",
    entityId: session.userId,
    metadata: { via: "admin_approval", adminUserId: admin.id },
  });

  return NextResponse.json({ ok: true, message: "Your password has been changed. Other devices have been signed out." });
}
