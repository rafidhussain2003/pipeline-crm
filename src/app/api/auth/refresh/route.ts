import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRefreshCookie, setRefreshCookie, setSessionCookie, clearRefreshCookie } from "@/lib/auth";
import { validateRefreshToken, revokeRefreshToken, issueRefreshToken } from "@/lib/refresh-tokens";

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

  await setSessionCookie({
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    email: user.email,
  });

  return NextResponse.json({ ok: true });
}
