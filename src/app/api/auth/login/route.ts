import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { users, companies } from "@/db/schema";
import { verifyPassword, setSessionCookie, setRefreshCookie, REMEMBER_ME_SESSION_DAYS } from "@/lib/auth";
import { issueRefreshToken, revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { activateSession } from "@/lib/auth/session-registry";
import { DEVICE_COOKIE_NAME, isTrustedDevice, registerTrustedDevice } from "@/lib/auth/device-trust";
import { requestCode, verifyCode } from "@/lib/auth/verification";
import { sendLoginOtpEmail } from "@/lib/email/send";
import { recordAudit } from "@/lib/audit";
import { checkPolicy, getClientIp, checkAccountLockout, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
  // Enterprise device security: the email OTP for a login from a browser
  // that is not (yet) a trusted device. Absent on the first attempt — the
  // response { otpRequired: true } tells the client to collect it.
  otp: z.string().optional(),
});

export async function POST(req: NextRequest) {
  return withRoute("auth.login", "POST", req, async (logger, requestId) => {
    const ip = getClientIp(req);
    const rl = checkPolicy("auth.login", ip);
    if (!rl.allowed) {
      logger.warn("rate_limited", { ip });
      return NextResponse.json({ error: "Too many login attempts. Please wait a minute and try again." }, { status: 429 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { email, password, rememberMe, otp } = parsed.data;
    const lockoutKey = `login:${email.toLowerCase()}`;

    const lockout = checkAccountLockout(lockoutKey);
    if (lockout.locked) {
      logger.warn("account_locked", { retryAfterMs: lockout.retryAfterMs });
      return NextResponse.json(
        { error: "Too many failed attempts on this account. Please try again later." },
        { status: 429 }
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !user.active || user.deletedAt) {
      recordLoginFailure(lockoutKey);
      await recordAudit({
        companyId: null,
        userId: null,
        action: "auth.login_failed",
        entityType: "user",
        requestId,
        metadata: { email, reason: !user ? "not_found" : "inactive" },
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      recordLoginFailure(lockoutKey);
      await recordAudit({
        companyId: user.companyId,
        userId: user.id,
        action: "auth.login_failed",
        entityType: "user",
        entityId: user.id,
        requestId,
        metadata: { reason: "wrong_password" },
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    if (user.companyId) {
      const [company] = await db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1);
      if (!company || company.status === "suspended" || company.deletedAt) {
        return NextResponse.json({ error: "This account is not active. Contact support." }, { status: 403 });
      }
    }

    logger.setContext({ userId: user.id, companyId: user.companyId });

    // --- Enterprise device security (OTP for unrecognized browsers) -------
    // Password is correct from here on. A browser holding a live trusted-
    // device token proceeds directly; anything else must pass an email OTP,
    // and passing it registers this browser as trusted for the Remember-Me
    // window (30 days).
    const deviceToken = req.cookies.get(DEVICE_COOKIE_NAME)?.value || null;
    const trusted = deviceToken ? await isTrustedDevice(user.id, deviceToken) : false;
    let newDeviceRegistered = false;

    if (!trusted) {
      if (!otp) {
        // Step 1 of the challenge: send the code, tell the client to ask.
        // Deliberately does NOT count as a login failure — the password was
        // right.
        const request = await requestCode({ email: user.email, purpose: "device_otp" });
        if (!request.ok) {
          return NextResponse.json({ otpRequired: true, error: request.error }, { status: 429 });
        }
        const sent = await sendLoginOtpEmail(user.email, request.code);
        // Same dev-mode convention as the other verification flows: when no
        // email provider is configured the code is readable from server logs.
        if (!sent) logger.warn("otp_email_not_sent", { code: request.code });
        await recordAudit({
          companyId: user.companyId,
          userId: user.id,
          action: "auth.otp_challenged",
          entityType: "user",
          entityId: user.id,
          requestId,
          metadata: { reason: "new_device" },
        });
        logger.info("otp_challenged");
        return NextResponse.json({
          otpRequired: true,
          message: "This device isn't recognized. Enter the verification code we emailed you.",
        });
      }
      const verified = await verifyCode({ email: user.email, purpose: "device_otp", code: otp });
      if (!verified.ok) {
        recordLoginFailure(lockoutKey);
        await recordAudit({
          companyId: user.companyId,
          userId: user.id,
          action: "auth.otp_failed",
          entityType: "user",
          entityId: user.id,
          requestId,
        });
        return NextResponse.json({ otpRequired: true, error: verified.error }, { status: 401 });
      }
      const registration = await registerTrustedDevice(user.id, req.headers.get("user-agent") || undefined);
      const store = await cookies();
      store.set(DEVICE_COOKIE_NAME, registration.rawToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        expires: registration.expiresAt,
      });
      newDeviceRegistered = true;
    }

    recordLoginSuccess(lockoutKey);

    // --- Single active session ------------------------------------------
    // Rotate the session registry FIRST (every previously issued JWT stops
    // validating), then revoke every refresh token so no other device can
    // silently mint a new session either. This login is the one session.
    const sessionId = await activateSession(user.id);
    await revokeAllRefreshTokensForUser(user.id);

    const sessionDays = rememberMe ? REMEMBER_ME_SESSION_DAYS : undefined;
    await setSessionCookie(
      {
        userId: user.id,
        companyId: user.companyId,
        role: user.role,
        email: user.email,
        sessionId,
      },
      sessionDays
    );

    const { rawToken, expiresAt } = await issueRefreshToken(user.id, req.headers.get("user-agent") || undefined);
    await setRefreshCookie(rawToken, expiresAt);

    await recordAudit({
      companyId: user.companyId,
      userId: user.id,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      requestId,
      metadata: { rememberMe: !!rememberMe, otpUsed: !trusted, newDevice: newDeviceRegistered },
    });

    logger.info("login_success", { rememberMe: !!rememberMe, otpUsed: !trusted });
    return NextResponse.json({ ok: true, role: user.role });
  });
}
