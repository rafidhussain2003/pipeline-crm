import { NextRequest, NextResponse } from "next/server";
import { getSession, signShortLived } from "@/lib/auth";
import { getFacebookAuthorizeUrl } from "@/lib/facebook-oauth";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (session.role !== "admin") {
    return NextResponse.redirect(new URL("/settings/connector?error=admin_only", req.url));
  }

  const rl = checkPolicy("oauth.facebook", getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.redirect(new URL("/settings/connector?error=rate_limited", req.url));
  }

  const redirectUri = new URL("/api/oauth/facebook/callback", req.url).toString();
  const state = signShortLived({ companyId: session.companyId }, "10m");

  return NextResponse.redirect(getFacebookAuthorizeUrl(redirectUri, state));
}
