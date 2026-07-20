import { NextResponse } from "next/server";
import { clearSessionCookie, clearRefreshCookie, getRefreshCookie, getSession } from "@/lib/auth";
import { revokeRefreshToken } from "@/lib/refresh-tokens";
import { invalidateAllSessions } from "@/lib/auth/session-registry";
import { recordAudit } from "@/lib/audit";

export async function POST() {
  const session = await getSession();
  const refreshToken = await getRefreshCookie();
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  await clearSessionCookie();
  await clearRefreshCookie();
  // Single-device security: retire the session id so the JWT itself is dead
  // server-side, not merely deleted from this browser's cookie jar. Device
  // trust is deliberately kept — logging out and back in on a trusted
  // device does not re-challenge for an OTP (Part 9).
  if (session) {
    await invalidateAllSessions(session.userId);
  }
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
