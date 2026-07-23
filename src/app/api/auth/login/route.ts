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
import { isSchemaLagError } from "@/lib/db-errors";
import { checkPolicy, getClientIp, checkAccountLockout, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { isIpBlocked, otpSendAllowed, recordStrike, trackLoginTarget } from "@/lib/security/abuse-guard";
import { recordSecurityEvent } from "@/lib/security/events";
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
    const userAgent = req.headers.get("user-agent");

    // Progressive temporary IP block (see abuse-guard): an IP that has been
    // hammering auth endpoints gets a flat 429 before any work happens.
    const block = isIpBlocked(ip);
    if (block.blocked) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const rl = checkPolicy("auth.login", ip);
    if (!rl.allowed) {
      logger.warn("rate_limited", { ip });
      const strike = recordStrike(ip, 2);
      await recordSecurityEvent({ event: "login.rate_limited", riskLevel: "medium", ip, userAgent, reason: "per-ip minute cap" });
      if (strike.blockedNow) {
        await recordSecurityEvent({ event: "ip.blocked", riskLevel: "high", ip, userAgent, reason: `login abuse — blocked ${Math.round(strike.blockMs / 60000)}m` });
      }
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
      recordStrike(ip);
      await recordSecurityEvent({ event: "login.locked", riskLevel: "medium", ip, userAgent, email, reason: "attempt while account locked" });
      return NextResponse.json(
        { error: "Too many failed attempts on this account. Please try again later." },
        { status: 429 }
      );
    }

    // Explicit columns, deliberately NOT select() (full row): the full row
    // includes columns added by recent migrations (current_session_id, 0038),
    // and against a database where those haven't been applied yet a full-row
    // select throws 42703 — which made EVERY login 500 before the password
    // was even checked. Sign-in must never depend on the newest migration.
    const [user] = await db
      .select({
        id: users.id,
        companyId: users.companyId,
        email: users.email,
        passwordHash: users.passwordHash,
        role: users.role,
        active: users.active,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    // Shared bookkeeping for BOTH failure shapes (unknown email and wrong
    // password) so the two stay byte-identical to the caller — the classic
    // enumeration channel is the difference between those responses.
    const noteFailure = async (companyId: string | null, userId: string | null, reason: string) => {
      const locked = recordLoginFailure(lockoutKey);
      recordStrike(ip);
      const target = trackLoginTarget(email, ip);
      await recordSecurityEvent({ event: "login.failed", riskLevel: "low", ip, userAgent, email, companyId, userId, reason });
      if (locked.lockedNow) {
        await recordSecurityEvent({ event: "account.locked", riskLevel: "high", ip, userAgent, email, companyId, userId, reason: "5 failed attempts — 15m lockout" });
      }
      if (target.suspicious) {
        await recordSecurityEvent({
          event: "credential_stuffing.detected", riskLevel: "high", ip, userAgent, email, companyId, userId,
          reason: `${target.distinctIps} distinct IPs failing on this account in an hour`,
        });
      }
    };

    if (!user || !user.active || user.deletedAt) {
      await noteFailure(null, null, !user ? "unknown email" : "inactive account");
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
      await noteFailure(user.companyId, user.id, "wrong password");
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
    let trusted = false;
    let newDeviceRegistered = false;
    // Migration lag guard: the whole device/OTP layer depends on 0038 (the
    // trusted_devices table and the device_otp enum value). If the schema is
    // behind the code, logins fall back to password-only — loudly logged,
    // never silent — instead of stranding the entire company at the door.
    // The layer re-arms by itself the moment the boot migrator
    // (src/instrumentation.ts) catches the database up.
    let deviceSecurityDegraded = false;
    try {
    trusted = deviceToken ? await isTrustedDevice(user.id, deviceToken) : false;

    if (!trusted) {
      if (!otp) {
        // Step 1 of the challenge: send the code, tell the client to ask.
        // Deliberately does NOT count as a login failure — the password was
        // right.
        //
        // OTP send caps (per identity + per IP, hourly): the password being
        // correct doesn't entitle unlimited email — a stolen password must
        // not become an OTP spam cannon. Denied = the success-shaped
        // response below WITHOUT a new email; any previously emailed code
        // stays valid.
        const gate = otpSendAllowed(user.email, ip);
        if (!gate.allowed) {
          await recordSecurityEvent({
            event: "otp.rate_limited", riskLevel: "medium", ip, userAgent, email: user.email,
            companyId: user.companyId, userId: user.id, reason: `${gate.reason.replace(/_/g, " ")} (login otp)`,
          });
          return NextResponse.json({
            otpRequired: true,
            message: "This device isn't recognized. Enter the verification code we emailed you.",
          });
        }
        const request = await requestCode({ email: user.email, purpose: "device_otp" });
        if (!request.ok) {
          // Within the 60s cooldown: the code already in their inbox is
          // valid — success-shaped response, no duplicate email (Email
          // Protection). Only a truly exhausted resend budget surfaces.
          if (request.retryAfterSec !== undefined) {
            return NextResponse.json({
              otpRequired: true,
              message: "Enter the verification code we emailed you.",
            });
          }
          await recordSecurityEvent({
            event: "otp.rate_limited", riskLevel: "medium", ip, userAgent, email: user.email,
            companyId: user.companyId, userId: user.id, reason: "resend budget exhausted (login otp)",
          });
          return NextResponse.json({ otpRequired: true, error: request.error }, { status: 429 });
        }
        const sent = await sendLoginOtpEmail(user.email, request.code);
        if (!sent.ok) {
          if (process.env.NODE_ENV === "production") {
            // In production a failed OTP email means sign-in from this device
            // CANNOT proceed — saying "check your email" would strand the
            // agent at a prompt waiting for mail that was never sent (which
            // is exactly how "OTP isn't working" looked from the outside).
            // Fail loudly with the provider's reason in the logs. The OTP is
            // NOT bypassed — that would trade a visible outage for a silent
            // security hole. The code is deliberately never logged here.
            logger.error("otp_email_send_failed", { reason: sent.reason || "unknown" });
            await recordSecurityEvent({
              event: "otp.email_failed", riskLevel: "high", ip, userAgent, email: user.email,
              companyId: user.companyId, userId: user.id, reason: sent.reason || "unknown",
            });
            await recordAudit({
              companyId: user.companyId,
              userId: user.id,
              action: "auth.otp_email_failed",
              entityType: "user",
              entityId: user.id,
              requestId,
              metadata: { reason: sent.reason || "unknown" },
            });
            return NextResponse.json(
              { error: "We couldn't send your verification code right now. Please try again shortly, or contact your administrator if this keeps happening." },
              { status: 502 }
            );
          }
          // Dev convention (no email provider configured): the code is
          // readable from server logs so the flow stays fully testable.
          logger.warn("otp_email_not_sent", { code: request.code, reason: sent.reason });
        }
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
        await recordSecurityEvent({
          event: "otp.sent", riskLevel: "low", ip, userAgent, email: user.email,
          companyId: user.companyId, userId: user.id, reason: "new device login",
        });
        return NextResponse.json({
          otpRequired: true,
          message: "This device isn't recognized. Enter the verification code we emailed you.",
        });
      }
      const verified = await verifyCode({ email: user.email, purpose: "device_otp", code: otp });
      if (!verified.ok) {
        recordLoginFailure(lockoutKey);
        recordStrike(ip);
        await recordSecurityEvent({
          event: "otp.failed", riskLevel: "medium", ip, userAgent, email: user.email,
          companyId: user.companyId, userId: user.id, reason: "wrong or expired code",
        });
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
    } catch (err) {
      if (!isSchemaLagError(err)) throw err;
      deviceSecurityDegraded = true;
      logger.error("device_security_degraded_schema_lag", {
        detail: "trusted_devices/device_otp schema (migration 0038) not applied — proceeding password-only",
      });
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
      metadata: {
        rememberMe: !!rememberMe,
        otpUsed: !trusted && !deviceSecurityDegraded,
        newDevice: newDeviceRegistered,
        ...(deviceSecurityDegraded ? { deviceSecurityDegraded: true } : {}),
      },
    });

    logger.info("login_success", { rememberMe: !!rememberMe, otpUsed: !trusted && !deviceSecurityDegraded, deviceSecurityDegraded });
    return NextResponse.json({ ok: true, role: user.role });
  });
}
