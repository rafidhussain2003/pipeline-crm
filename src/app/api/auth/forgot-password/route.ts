import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requestCode } from "@/lib/auth/verification";
import { sendPasswordResetEmail } from "@/lib/email/send";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { isIpBlocked, otpSendAllowed, recordStrike, trackOtpFanout } from "@/lib/security/abuse-guard";
import { recordSecurityEvent } from "@/lib/security/events";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({ email: z.string().email() });

// Password reset step 1: email a reset code IF the account exists. Always
// returns the same generic response so it can't be used to enumerate
// accounts — including on every abuse-guard branch (blocked IP, OTP caps,
// bot signals): a denied request looks exactly like a sent one, and no
// email leaves the building.
export async function POST(req: NextRequest) {
  return withRoute("auth.forgot-password", "POST", req, async (logger) => {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent");
    const generic = () =>
      NextResponse.json({ ok: true, message: "If an account exists for that email, a reset code is on its way." });

    if (isIpBlocked(ip).blocked) return generic();

    if (!checkPolicy("auth.password_reset", ip).allowed) {
      const strike = recordStrike(ip, 2);
      await recordSecurityEvent({ event: "otp.rate_limited", riskLevel: "medium", ip, userAgent, reason: "password-reset per-ip minute cap" });
      if (strike.blockedNow) {
        await recordSecurityEvent({ event: "ip.blocked", riskLevel: "high", ip, userAgent, reason: `password-reset abuse — blocked ${Math.round(strike.blockMs / 60000)}m` });
      }
      return generic();
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    const email = parsed.data.email.toLowerCase();

    const fanout = trackOtpFanout(email, ip);
    if (fanout.suspicious) {
      const strike = recordStrike(ip, 5);
      await recordSecurityEvent({
        event: "credential_stuffing.detected", riskLevel: "high", ip, userAgent, email,
        reason: `${fanout.fanout} distinct identities from one IP in an hour (password reset)`,
      });
      if (strike.blockedNow) {
        await recordSecurityEvent({ event: "ip.blocked", riskLevel: "high", ip, userAgent, reason: `reset spraying — blocked ${Math.round(strike.blockMs / 60000)}m` });
      }
      return generic();
    }

    const gate = otpSendAllowed(email, ip);
    if (!gate.allowed) {
      recordStrike(ip, gate.reason === "disposable_domain" || gate.reason === "variant_abuse" ? 3 : 1);
      await recordSecurityEvent({
        event: gate.reason === "disposable_domain" || gate.reason === "variant_abuse" ? "bot.detected" : "otp.rate_limited",
        riskLevel: gate.reason === "disposable_domain" || gate.reason === "variant_abuse" ? "high" : "medium",
        ip, userAgent, email, reason: `${gate.reason.replace(/_/g, " ")} (password reset)`,
      });
      return generic();
    }

    const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), eq(users.active, true), isNull(users.deletedAt))).limit(1);
    if (user) {
      const result = await requestCode({ email, purpose: "password_reset" });
      if (result.ok) {
        const sent = await sendPasswordResetEmail(email, result.code);
        // The code is deliberately NOT logged. It is a live credential: with
        // it (and the email beside it) anyone holding the logs — including a
        // third-party log aggregator or error tracker — can complete a
        // password reset for this account. Log that delivery failed, never
        // what would have been delivered.
        if (!sent) logger.warn("reset_email_not_sent", { email });
        await recordSecurityEvent({ event: "otp.sent", riskLevel: "low", ip, userAgent, email, userId: user.id, reason: "password reset" });
      }
      // Within the cooldown (!result.ok): the earlier code is still valid —
      // generic success, no extra email.
    }
    // Generic response regardless of whether the account exists.
    return generic();
  });
}
