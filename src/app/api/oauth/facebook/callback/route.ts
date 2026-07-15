import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyShortLived, signShortLived } from "@/lib/auth";
import { PENDING_PAGES_COOKIE } from "@/lib/facebook-oauth";
import { getProvider } from "@/lib/lead-sources/registry";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { getPublicAppUrl } from "@/lib/url";
import { db } from "@/db";
import { connectedAccounts, leadSources } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { and, eq, isNull } from "drizzle-orm";

export async function GET(req: NextRequest) {
  // Every absolute URL below is built from getPublicAppUrl(), never from
  // req.url — see lib/url.ts for why request-derived URLs break behind
  // Render's reverse proxy. `searchParams` alone (code/state/error) is
  // read from req.url below, which is fine — that's just parsing the
  // incoming query string, not building an outgoing URL.
  const appUrl = getPublicAppUrl();

  const rl = checkPolicy("oauth.facebook", getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.redirect(new URL("/settings/connector?error=rate_limited", appUrl));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL(`/settings/connector?error=${encodeURIComponent(oauthError)}`, appUrl));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings/connector?error=missing_code", appUrl));
  }

  const statePayload = verifyShortLived<{
    companyId: string;
    reconnectSourceId: string | null;
    reconnectAccountId: string | null;
  }>(state);
  if (!statePayload) {
    return NextResponse.redirect(new URL("/settings/connector?error=invalid_state", appUrl));
  }

  // Defense in depth, matching the same check already done in
  // pending/route.ts and forms/route.ts: `state` alone proves this browser
  // legitimately started the flow, but this route is about to write a
  // connectedAccounts row, so it re-confirms there's still a live admin
  // session for that same company before doing so.
  const session = await getSession();
  if (!session || !session.companyId || session.companyId !== statePayload.companyId || session.role !== "admin") {
    return NextResponse.redirect(new URL("/settings/connector?error=invalid_state", appUrl));
  }

  try {
    const provider = getProvider("facebook")!;

    // Must be byte-for-byte identical to the redirect_uri used in
    // /api/oauth/facebook/start — Facebook's token exchange rejects a
    // mismatch.
    const redirectUri = new URL("/api/oauth/facebook/callback", appUrl).toString();
    const { accessToken: longLivedToken, expiresIn } = await provider.exchangeCodeForToken(code, redirectUri);
    const identity = await provider.fetchAccountIdentity(longLivedToken);
    const pages = await provider.listContainers(longLivedToken);

    if (pages.length === 0) {
      return NextResponse.redirect(
        new URL("/settings/connector?error=no_pages_found", appUrl)
      );
    }

    // One row per real-world Meta login, never duplicated: reconnecting or
    // connecting another Page from the same login resolves back to this
    // same account via the (companyId, platform, externalAccountId)
    // unique index — see connectedAccounts in db/schema.ts. Logging in as
    // a different Meta identity naturally creates a new row here, which is
    // the entire mechanism behind supporting unlimited connected accounts
    // without a dedicated "add another account" flow.
    // Phase 11: store the long-lived USER token (encrypted) on the account so
    // Conversions API can reuse this one OAuth grant — no second Meta login.
    const accountTokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    const [account] = await db
      .insert(connectedAccounts)
      .values({
        companyId: statePayload.companyId,
        platform: "facebook",
        externalAccountId: identity.id,
        accountLabel: identity.label,
        status: "connected",
        accessToken: encrypt(longLivedToken),
        tokenExpiresAt: accountTokenExpiresAt,
        createdBy: session.userId,
      })
      .onConflictDoUpdate({
        target: [connectedAccounts.companyId, connectedAccounts.platform, connectedAccounts.externalAccountId],
        set: { accountLabel: identity.label, status: "connected", deletedAt: null, accessToken: encrypt(longLivedToken), tokenExpiresAt: accountTokenExpiresAt },
      })
      .returning();

    // Account-level Reconnect: refresh every Page already connected under
    // this account in one pass — no re-picking needed, since we already
    // know which pages the customer wants and just need fresh tokens for
    // them. Matches by pageId against the freshly-fetched container list;
    // a page that's disappeared from that list (removed/lost access) is
    // simply left as-is rather than guessed at — Sync Now or a look at
    // View Details will surface it as an error on its own.
    if (statePayload.reconnectAccountId === account.id) {
      const existingSources = await db
        .select({ id: leadSources.id, pageId: leadSources.pageId })
        .from(leadSources)
        .where(and(eq(leadSources.accountId, account.id), isNull(leadSources.deletedAt)));

      const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
      let refreshed = 0;
      for (const existing of existingSources) {
        const page = pages.find((p) => p.id === existing.pageId);
        if (!page) continue;
        try {
          await provider.subscribeWebhook(page.id, page.accessToken);
        } catch (err) {
          console.error(`Failed to re-subscribe webhook for page ${page.id} during account reconnect:`, err);
          continue;
        }
        await db
          .update(leadSources)
          .set({
            businessId: page.business?.id || null,
            businessName: page.business?.name || null,
            accessToken: encrypt(page.accessToken),
            status: "connected",
            webhookStatus: "active",
            lastError: null,
            tokenExpiresAt,
          })
          .where(eq(leadSources.id, existing.id));
        refreshed++;
      }

      return NextResponse.redirect(
        new URL(`/settings/connector?reconnected=1&refreshed=${refreshed}`, appUrl)
      );
    }

    // Hold the fetched pages (with their page access tokens, business
    // grouping, and the token's expiry) in a short-lived signed, httpOnly
    // cookie until the admin picks which page + lead forms to connect.
    // Nothing else is written to the database yet — only what gets
    // explicitly selected gets persisted, in the finalize step.
    const pendingToken = signShortLived(
      {
        companyId: statePayload.companyId,
        accountId: account.id,
        pages,
        tokenExpiresIn: expiresIn,
        reconnectSourceId: statePayload.reconnectSourceId,
      },
      "10m"
    );

    const response = NextResponse.redirect(new URL("/settings/connector?connected=1", appUrl));
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
    return NextResponse.redirect(new URL("/settings/connector?error=oauth_failed", appUrl));
  }
}
