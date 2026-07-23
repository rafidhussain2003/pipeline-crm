import { NextResponse } from "next/server";
import { db } from "@/db";
import { securityEvents } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/permissions";
import { getBlockedIpsSnapshot } from "@/lib/security/abuse-guard";
import { listActiveLockouts } from "@/lib/rate-limit";
import { isSchemaLagError } from "@/lib/db-errors";
import { and, count, desc, gte, inArray, isNotNull } from "drizzle-orm";

// Security dashboard data (Platform Owner). Everything here is derived from
// the security_events table (last 24h) plus the live in-memory state
// (currently blocked IPs, currently locked accounts). Platform-owner-only:
// events span tenants (pre-auth traffic has no company), so no company admin
// may read this.

const MALICIOUS_EVENTS = [
  "login.failed",
  "login.rate_limited",
  "otp.rate_limited",
  "otp.failed",
  "bot.detected",
  "credential_stuffing.detected",
] as const;

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const since = new Date(Date.now() - 24 * 60 * 60_000);

  let countsByEvent: Record<string, number> = {};
  let topIps: { ip: string; events: number }[] = [];
  let topEmails: { email: string; events: number }[] = [];
  let recent: unknown[] = [];
  let tableMissing = false;

  try {
    const [eventCounts, ipRows, emailRows, recentRows] = await Promise.all([
      db
        .select({ event: securityEvents.event, value: count() })
        .from(securityEvents)
        .where(gte(securityEvents.createdAt, since))
        .groupBy(securityEvents.event),
      db
        .select({ ip: securityEvents.ip, value: count() })
        .from(securityEvents)
        .where(and(gte(securityEvents.createdAt, since), isNotNull(securityEvents.ip), inArray(securityEvents.event, [...MALICIOUS_EVENTS])))
        .groupBy(securityEvents.ip)
        .orderBy(desc(count()))
        .limit(10),
      db
        .select({ email: securityEvents.email, value: count() })
        .from(securityEvents)
        .where(and(gte(securityEvents.createdAt, since), isNotNull(securityEvents.email), inArray(securityEvents.event, ["login.failed", "otp.failed"])))
        .groupBy(securityEvents.email)
        .orderBy(desc(count()))
        .limit(10),
      db
        .select({
          event: securityEvents.event,
          riskLevel: securityEvents.riskLevel,
          email: securityEvents.email,
          ip: securityEvents.ip,
          reason: securityEvents.reason,
          createdAt: securityEvents.createdAt,
        })
        .from(securityEvents)
        .orderBy(desc(securityEvents.createdAt), desc(securityEvents.id))
        .limit(50),
    ]);
    countsByEvent = Object.fromEntries(eventCounts.map((r) => [r.event, r.value]));
    topIps = ipRows.filter((r) => r.ip).map((r) => ({ ip: r.ip!, events: r.value }));
    topEmails = emailRows.filter((r) => r.email).map((r) => ({ email: r.email!, events: r.value }));
    recent = recentRows;
  } catch (err) {
    if (!isSchemaLagError(err)) throw err;
    // Migration 0043 not applied yet — the dashboard still shows live
    // in-memory state, with an explicit flag instead of fake zeros.
    tableMissing = true;
  }

  const sum = (...events: string[]) => events.reduce((acc, e) => acc + (countsByEvent[e] || 0), 0);

  return NextResponse.json({
    tableMissing,
    window: "24h",
    stats: {
      failedLogins: sum("login.failed"),
      otpSent: sum("otp.sent"),
      otpFailed: sum("otp.failed"),
      rateLimited: sum("login.rate_limited", "otp.rate_limited"),
      botDetections: sum("bot.detected", "credential_stuffing.detected"),
      accountLocks: sum("account.locked"),
      ipBlocks: sum("ip.blocked"),
      emailSendFailures: sum("otp.email_failed"),
    },
    topIps,
    topEmails,
    recent,
    liveBlockedIps: getBlockedIpsSnapshot(),
    liveLockedAccounts: listActiveLockouts().map((l) => ({
      // lockout keys look like "login:email@domain" — show the email part.
      account: l.key.startsWith("login:") ? l.key.slice(6) : l.key,
      failures: l.failures,
      lockedUntil: l.lockedUntilIso,
    })),
  });
}
