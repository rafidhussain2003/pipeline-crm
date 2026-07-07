import crypto from "crypto";
import { db } from "@/db";
import { refreshTokens } from "@/db/schema";
import { and, eq, isNull, gt, isNotNull, lt, or } from "drizzle-orm";

const REFRESH_TOKEN_TTL_DAYS = 30;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(userId: string, userAgent?: string) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(rawToken),
    expiresAt,
    userAgent: userAgent?.slice(0, 255),
  });

  return { rawToken, expiresAt };
}

export async function validateRefreshToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
    .limit(1);
  return row || null;
}

export async function revokeRefreshToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash));
}

export async function revokeAllRefreshTokensForUser(userId: string) {
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, userId));
}

// Revoke one specific session by its row id (used by the Security tab's
// per-session "revoke" action) — scoped to userId so a user can only ever
// revoke their own sessions, never guess another user's session id.
export async function revokeRefreshTokenById(id: string, userId: string) {
  const [revoked] = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, id), eq(refreshTokens.userId, userId)))
    .returning({ id: refreshTokens.id });
  return revoked || null;
}

// No cleanup of this table existed anywhere until now — every issued
// token, expired or revoked, stayed in the table forever. Deletes rows
// that are no longer useful for anything: already expired, or already
// revoked (logout / password change / this same cleanup's future runs).
// A live, valid token is never touched. See /api/cron/cleanup-tokens.
export async function cleanupExpiredRefreshTokens(): Promise<number> {
  const deleted = await db
    .delete(refreshTokens)
    .where(or(lt(refreshTokens.expiresAt, new Date()), isNotNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return deleted.length;
}
