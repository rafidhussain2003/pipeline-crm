import crypto from "crypto";
import { db } from "@/db";
import { refreshTokens } from "@/db/schema";
import { and, eq, isNull, gt } from "drizzle-orm";

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
