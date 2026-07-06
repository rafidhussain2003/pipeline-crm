import { NextResponse } from "next/server";
import { clearSessionCookie, clearRefreshCookie, getRefreshCookie, getSession } from "@/lib/auth";
import { revokeRefreshToken } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";

export async function POST() {
  const session = await getSession();
  const refreshToken = await getRefreshCookie();
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  await clearSessionCookie();
  await clearRefreshCookie();
  if (session) {
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "auth.logout",
      entityType: "user",
      entityId: session.userId,
    });
  }
  return NextResponse.json({ ok: true });
}
