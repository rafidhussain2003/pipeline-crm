import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRefreshCookie, setRefreshCookie, setSessionCookie, clearRefreshCookie } from "@/lib/auth";
import { validateRefreshToken, revokeRefreshToken, issueRefreshToken } from "@/lib/refresh-tokens";
import { activateSession } from "@/lib/auth/session-registry";

export async function POST() {
  const rawToken = await getRefreshCookie();
  if (!rawToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  const record = await validateRefreshToken(rawToken);
  if (!record) {
    await clearRefreshCookie();
    return NextResponse.json({ error: "Refresh token invalid or expired" }, { status: 401 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, record.userId)).limit(1);
  if (!user || !user.active || user.deletedAt) {
    await clearRefreshCookie();
    return NextResponse.json({ error: "Account no longer active" }, { status: 401 });
  }

  // Rotate: revoke the used token, issue a fresh one. This limits the blast
  // radius if a refresh token is ever leaked (it's single-use).
  await revokeRefreshToken(rawToken);
  const { rawToken: newToken, expiresAt } = await issueRefreshToken(user.id);
  await setRefreshCookie(newToken, expiresAt);

  // Single-device security: a refresh continues the ONE active session, so
  // the new JWT carries the user row's current session id. A live refresh
  // token with no stored session id (issued pre-rollout) activates one now.
  // A refresh token surviving from an older session can't get here — every
  // new login revokes all previous refresh tokens.
  const sessionId = user.currentSessionId ?? (await activateSession(user.id));

  await setSessionCookie({
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
    sessionId,
  });

  return NextResponse.json({ ok: true });
}
