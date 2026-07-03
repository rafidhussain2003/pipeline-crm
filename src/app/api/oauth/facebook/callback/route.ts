import { NextRequest, NextResponse } from "next/server";
import { verifyShortLived, signShortLived } from "@/lib/auth";
import { PENDING_PAGES_COOKIE } from "@/lib/facebook-oauth";
import {
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  fetchUserPages,
} from "@/lib/facebook-oauth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL(`/settings/connector?error=${encodeURIComponent(oauthError)}`, req.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings/connector?error=missing_code", req.url));
  }

  const statePayload = verifyShortLived<{ companyId: string }>(state);
  if (!statePayload) {
    return NextResponse.redirect(new URL("/settings/connector?error=invalid_state", req.url));
  }

  try {
    const redirectUri = new URL("/api/oauth/facebook/callback", req.url).toString();
    const shortLivedToken = await exchangeCodeForUserToken(code, redirectUri);
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken);
    const pages = await fetchUserPages(longLivedToken);

    if (pages.length === 0) {
      return NextResponse.redirect(
        new URL("/settings/connector?error=no_pages_found", req.url)
      );
    }

    // Hold the fetched pages (with their page access tokens) in a short-lived
    // signed, httpOnly cookie until the admin picks which ones to connect.
    // Nothing is written to the database yet — only encrypted, connected
    // pages get persisted, in the finalize step.
    const pendingToken = signShortLived({ companyId: statePayload.companyId, pages }, "10m");

    const response = NextResponse.redirect(new URL("/settings/connector?connected=1", req.url));
    response.cookies.set(PENDING_PAGES_COOKIE, pendingToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    return response;
  } catch (err) {
    console.error("Facebook OAuth callback error:", err);
    return NextResponse.redirect(new URL("/settings/connector?error=oauth_failed", req.url));
  }
}
