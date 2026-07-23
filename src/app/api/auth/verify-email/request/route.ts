import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requestCode } from "@/lib/auth/verification";
import { sendVerificationEmail } from "@/lib/email/send";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { isIpBlocked, otpSendAllowed, recordStrike, trackOtpFanout } from "@/lib/security/abuse-guard";
import { recordSecurityEvent } from "@/lib/security/events";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({ name: z.string().min(2), companyName: z.string().min(2), email: z.string().email() });

// Step 1 of signup: email a 6-digit verification code (carrying the pending
// name + company).
//
// SECURITY-HARDENED (this endpoint was actively abused in production — bots
// feeding it dotted-Gmail variants and disposable domains to make Resend
// deliver spam codes). Two rules govern every branch below:
//
//   1. ONE GENERIC RESPONSE. Whether the address is new, already registered,
//      disposable, rate-capped, or the IP is blocked — the caller sees the
//      same { ok: true } "check your email" shape. No enumeration, and a bot
//      can't tell which of its tricks stopped working.
//   2. EMAIL IS THE PROTECTED RESOURCE. Suspicious or capped requests
//      short-circuit BEFORE any email is generated or sent; repeats within
//      the cooldown return success without re-sending.
export async function POST(req: NextRequest) {
  return withRoute("auth.verify-email.request", "POST", req, async (logger) => {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent");
    const generic = () => NextResponse.json({ ok: true, cooldownSec: 60 });

    const block = isIpBlocked(ip);
    if (block.blocked) return generic();

    if (!checkPolicy("auth.signup", ip).allowed) {
      const strike = recordStrike(ip, 2);
      await recordSecurityEvent({ event: "otp.rate_limited", riskLevel: "medium", ip, userAgent, reason: "signup per-ip minute cap" });
      if (strike.blockedNow) {
        await recordSecurityEvent({ event: "ip.blocked", riskLevel: "high", ip, userAgent, reason: `signup abuse — blocked ${Math.round(strike.blockMs / 60000)}m` });
      }
      return generic();
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter your name, company, and a valid email." }, { status: 400 });
    const { name, companyName, email } = parsed.data;

    // Bot-pattern bookkeeping: one IP requesting codes for many distinct
    // identities is spraying, whatever else checks out.
    const fanout = trackOtpFanout(email, ip);
    if (fanout.suspicious) {
      const strike = recordStrike(ip, 5);
      await recordSecurityEvent({
        event: "bot.detected", riskLevel: "high", ip, userAgent, email,
        reason: `${fanout.fanout} distinct identities from one IP in an hour`,
      });
      if (strike.blockedNow) {
        await recordSecurityEvent({ event: "ip.blocked", riskLevel: "high", ip, userAgent, reason: `identity spraying — blocked ${Math.round(strike.blockMs / 60000)}m` });
      }
      return generic();
    }

    // The send gate: disposable domains, dotted-Gmail variant abuse, and
    // per-identity/per-IP hourly + burst caps. Denied = no email exists to
    // send; the response stays indistinguishable.
    const gate = otpSendAllowed(email, ip);
    if (!gate.allowed) {
      const isBotSignal = gate.reason === "disposable_domain" || gate.reason === "variant_abuse";
      recordStrike(ip, isBotSignal ? 3 : 1);
      await recordSecurityEvent({
        event: isBotSignal ? "bot.detected" : "otp.rate_limited",
        riskLevel: isBotSignal ? "high" : "medium",
        ip, userAgent, email,
        reason: gate.reason.replace(/_/g, " "),
      });
      return generic();
    }

    // Already registered → same generic response, and NO email is sent.
    // (Deliberate enumeration-protection tradeoff: a person who forgot they
    // have an account waits for a code that doesn't come, then signs in via
    // the login page instead. The API never says "this email exists".)
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existing) {
      await recordSecurityEvent({ event: "otp.rate_limited", riskLevel: "low", ip, userAgent, email, reason: "signup requested for registered email — suppressed" });
      return generic();
    }

    const result = await requestCode({ email, purpose: "signup", payload: { name, companyName } });
    if (!result.ok) {
      // Inside the 60s cooldown (or over the resend cap): success WITHOUT a
      // new email — the code already delivered is still valid.
      return generic();
    }

    const sent = await sendVerificationEmail(email, result.code);
    // Dev fallback: when email isn't configured, log THAT it failed — the
    // code itself is a live credential and never goes to the logs.
    if (!sent) logger.warn("verification_email_not_sent", { email });
    await recordSecurityEvent({ event: "otp.sent", riskLevel: "low", ip, userAgent, email, reason: "signup verification" });

    return NextResponse.json({ ok: true, resend: result.resend, cooldownSec: 60 });
  });
}
