import { NextResponse } from "next/server";
import { db } from "@/db";
import { refreshTokens, auditLog, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull, gt, desc } from "drizzle-orm";

// Profile > Security tab. Reuses existing tables rather than adding new
// ones: "Active Sessions" is the refresh_tokens table (already the
// DB-backed, revocable session store every login/logout already uses),
// and "Last Login" is read from audit_log's most recent auth.login row
// for this user (already recorded on every login) rather than a new
// column — passwordChangedAt is the one genuinely new field, since
// nothing else already tracks it.
//
// Deliberately NOT flagging which session is "this device": the refresh
// cookie is scoped to path=/api/auth (an existing, intentional hardening
// choice — see setRefreshCookie in src/lib/auth.ts), so it's never sent
// to this route, and there's no reliable way to identify the current
// session without widening that cookie's scope. Not required by the
// spec, so left out rather than loosening an existing security boundary
// for a label.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [sessions, lastLoginRow, userRow] = await Promise.all([
    db
      .select({ id: refreshTokens.id, userAgent: refreshTokens.userAgent, createdAt: refreshTokens.createdAt, expiresAt: refreshTokens.expiresAt })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, session.userId), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
      .orderBy(desc(refreshTokens.createdAt)),
    db
      .select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(and(eq(auditLog.userId, session.userId), eq(auditLog.action, "auth.login")))
      .orderBy(desc(auditLog.createdAt))
      .limit(1),
    db.select({ passwordChangedAt: users.passwordChangedAt }).from(users).where(eq(users.id, session.userId)).limit(1),
  ]);

  return NextResponse.json({
    sessions,
    lastLoginAt: lastLoginRow[0]?.createdAt || null,
    passwordChangedAt: userRow[0]?.passwordChangedAt || null,
  });
}
