import { NextRequest, NextResponse } from "next/server";
import { getSession, signShortLived } from "@/lib/auth";
import { getProvider } from "@/lib/lead-sources/registry";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { getPublicAppUrl } from "@/lib/url";
import { isFacebookConfigured } from "@/lib/facebook-oauth";
import { db } from "@/db";
import { leadSources, connectedAccounts } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export async function GET(req: NextRequest) {
  // Every absolute URL below is built from getPublicAppUrl(), never from
  // req.url — see lib/url.ts for why request-derived URLs break behind
  // Render's reverse proxy.
  const appUrl = getPublicAppUrl();

  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }
  if (session.role !== "admin") {
    return NextResponse.redirect(new URL("/settings/connector?error=admin_only", appUrl));
  }

  // Catches FACEBOOK_APP_ID/SECRET being unset OR left as a non-numeric
  // stand-in value (e.g. "placeholder") in the hosting provider's
  // environment settings — fails here with a clear message instead of
  // building a Facebook URL that only fails once the customer is already
  // on Facebook's own "Invalid App ID" error page.
  if (!isFacebookConfigured()) {
    return NextResponse.redirect(new URL("/settings/connector?error=facebook_not_configured", appUrl));
  }

  const rl = checkPolicy("oauth.facebook", getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.redirect(new URL("/settings/connector?error=rate_limited", appUrl));
  }

  // "Reconnect" on an existing connection re-runs the same OAuth flow, but
  // carries the existing source's id through `state` so the callback ->
  // finalize path updates that row (refreshed token, re-subscribed
  // webhook) instead of inserting a duplicate one.
  const reconnectSourceId = req.nextUrl.searchParams.get("reconnect");
  let verifiedReconnectSourceId: string | null = null;
  if (reconnectSourceId) {
    const [existing] = await db
      .select({ id: leadSources.id })
      .from(leadSources)
      .where(
        and(
          eq(leadSources.id, reconnectSourceId),
          eq(leadSources.companyId, session.companyId),
          eq(leadSources.platform, "facebook"),
          isNull(leadSources.deletedAt)
        )
      )
      .limit(1);
    if (!existing) {
      return NextResponse.redirect(new URL("/settings/connector?error=source_not_found", appUrl));
    }
    verifiedReconnectSourceId = existing.id;
  }

  // Account-level "Reconnect" (see the Lead Sources page's per-account
  // button) re-runs the same OAuth flow scoped to one connected account —
  // on return, the callback bulk-refreshes every Page already connected
  // under it in one pass, with no further picking required.
  const reconnectAccountId = req.nextUrl.searchParams.get("reconnectAccount");
  let verifiedReconnectAccountId: string | null = null;
  if (reconnectAccountId) {
    const [existing] = await db
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.id, reconnectAccountId),
          eq(connectedAccounts.companyId, session.companyId),
          eq(connectedAccounts.platform, "facebook"),
          isNull(connectedAccounts.deletedAt)
        )
      )
      .limit(1);
    if (!existing) {
      return NextResponse.redirect(new URL("/settings/connector?error=source_not_found", appUrl));
    }
    verifiedReconnectAccountId = existing.id;
  }

  const provider = getProvider("facebook")!;

  // This must exactly match what the callback route uses when exchanging
  // the code for a token, AND must be registered as a "Valid OAuth
  // Redirect URI" in the Facebook App's dashboard — Facebook rejects the
  // authorize request outright if this doesn't match a real, public HTTPS
  // URL it recognizes.
  const redirectUri = new URL("/api/oauth/facebook/callback", appUrl).toString();
  const state = signShortLived(
    {
      companyId: session.companyId,
      reconnectSourceId: verifiedReconnectSourceId,
      reconnectAccountId: verifiedReconnectAccountId,
    },
    "10m"
  );

  return NextResponse.redirect(provider.getAuthorizeUrl(redirectUri, state));
}
