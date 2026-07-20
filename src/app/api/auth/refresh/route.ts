import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRefreshCookie, setRefreshCookie, setSessionCookie, clearRefreshCookie } from "@/lib/auth";
import { validateRefreshToken, revokeRefreshToken, issueRefreshToken } from "@/lib/refresh-tokens";
import { activateSession } from "@/lib/auth/session-registry";
import { isSchemaLagError } from "@/lib/db-errors";

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

  // Explicit columns, not select() (full row): a full-row select includes
  // the newest migrations' columns and throws 42703 against a database that
  // hasn't applied them yet — session renewal must never depend on that
  // (see the login route for the same discipline). current_session_id (0038)
  // is read separately below under its own migration-lag guard.
  const [user] = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      email: users.email,
      role: users.role,
      active: users.active,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, record.userId))
    .limit(1);
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
  // new login revokes all previous refresh tokens. Read under a migration-
  // lag guard: if the 0038 column isn't there yet, renewal proceeds and
  // enforcement begins once the boot migrator lands it.
  let storedSessionId: string | null = null;
  try {
    const [row] = await db
      .select({ currentSessionId: users.currentSessionId })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    storedSessionId = row?.currentSessionId ?? null;
  } catch (err) {
    if (!isSchemaLagError(err)) throw err;
    console.error("[auth-refresh] current_session_id column missing — migration 0038 not applied yet");
  }
  const sessionId = storedSessionId ?? (await activateSession(user.id));

  await setSessionCookie({
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
    sessionId,
  });

  return NextResponse.json({ ok: true });
}
