// Security event log — the persistent trail behind the Security dashboard.
// Every write is best-effort by contract: recording a security event must
// NEVER fail (or slow) the authentication flow it describes, and must work
// even while migration 0043 hasn't reached the database yet (schema-lag —
// the event is loudly logged to the console instead of stored).
import { db } from "@/db";
import { securityEvents } from "@/db/schema";
import { isSchemaLagError } from "@/lib/db-errors";

export type SecurityEventName =
  | "login.failed"
  | "login.locked"
  | "login.rate_limited"
  | "otp.sent"
  | "otp.rate_limited"
  | "otp.failed"
  | "otp.email_failed"
  | "bot.detected"
  | "credential_stuffing.detected"
  | "account.locked"
  | "ip.blocked";

export type RiskLevel = "low" | "medium" | "high";

export async function recordSecurityEvent(params: {
  event: SecurityEventName;
  riskLevel: RiskLevel;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  companyId?: string | null;
  userId?: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      event: params.event,
      riskLevel: params.riskLevel,
      email: params.email?.slice(0, 255) ?? null,
      ip: params.ip?.slice(0, 64) ?? null,
      userAgent: params.userAgent?.slice(0, 255) ?? null,
      companyId: params.companyId ?? null,
      userId: params.userId ?? null,
      reason: params.reason ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    if (isSchemaLagError(err)) {
      console.error(
        `[security] events table missing (migration 0043 pending) — ${params.event} risk=${params.riskLevel} ip=${params.ip ?? "-"} email=${params.email ?? "-"} reason=${params.reason ?? "-"}`
      );
      return;
    }
    console.error("[security] failed to record event:", err instanceof Error ? err.message : err);
  }
}
