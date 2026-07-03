import { NextResponse } from "next/server";
import { clearSessionCookie, clearRefreshCookie, getRefreshCookie } from "@/lib/auth";
import { revokeRefreshToken } from "@/lib/refresh-tokens";

export async function POST() {
  const refreshToken = await getRefreshCookie();
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  await clearSessionCookie();
  await clearRefreshCookie();
  return NextResponse.json({ ok: true });
}
