import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeAllRefreshTokensForUser } from "@/lib/refresh-tokens";
import { recordAudit } from "@/lib/audit";

// "Logout From All Devices" — revokes every refresh token for this user,
// same effect changing your password already has (see
// /api/auth/change-password). The current tab's session cookie is a
// stateless JWT and stays valid until it naturally expires (documented,
// pre-existing behavior — see src/lib/auth.ts), not something this
// endpoint changes; only other devices/tabs actually get signed out
// immediately since their next request needs a valid refresh token.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await revokeAllRefreshTokensForUser(session.userId);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "account.sessions_revoked",
    entityType: "user",
    entityId: session.userId,
  });

  return NextResponse.json({ ok: true });
}
