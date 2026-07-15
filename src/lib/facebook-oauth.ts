const GRAPH_VERSION = "v19.0";
const FB_APP_ID = process.env.FACEBOOK_APP_ID || "";
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";

// A real Facebook App ID is always purely numeric (15-16 digits). Checked
// before ever building a Facebook URL so a missing or placeholder env var
// (e.g. FACEBOOK_APP_ID literally left as "placeholder" in a hosting
// provider's dashboard) fails with a clear in-app message instead of
// silently sending the customer to Facebook's own cryptic "Invalid App ID"
// error page — see /api/oauth/facebook/start's use of this.
export function isFacebookConfigured(): boolean {
  return /^\d+$/.test(FB_APP_ID) && FB_APP_SECRET.length > 0;
}

// Name of the short-lived httpOnly cookie that temporarily holds fetched
// pages (with their page access tokens and business grouping) between the
// OAuth callback and the admin picking which page + lead forms to connect
// (see /api/oauth/facebook/callback and /api/lead-sources/facebook/*).
export const PENDING_PAGES_COOKIE = "fb_pending_pages";

// Scopes needed to: list the pages a user manages, group them by Business
// (business_management — required to read the Page.business field), read
// their lead forms, keep reading page info/engagement for the connector
// UI, and label the connected account with the person's email (so a
// company connecting multiple Meta logins can tell them apart on the Lead
// Sources page — see connectedAccounts in db/schema.ts). business_management
// is Advanced Access and needs Meta App Review before non-Tester accounts
// can use it — see README.
const SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "leads_retrieval",
  "pages_read_engagement",
  "business_management",
  // Phase 11 (Conversions API): the SAME OAuth grant now also covers CAPI —
  // ads_read lists the account's ad accounts + pixels for selection, and
  // ads_management authorizes POSTing conversion events to a pixel. Advanced
  // Access (App Review) like business_management; existing connections keep
  // working for Lead Ads and gain CAPI on their next reconnect.
  "ads_read",
  "ads_management",
  "email",
].join(",");

export function getFacebookAuthorizeUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: FB_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForUserToken(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: FB_APP_ID,
    client_secret: FB_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Facebook token exchange failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

// Exchanging for a long-lived user token means the page tokens derived from
// it don't expire on the usual 1-2hr window — this is what makes the
// connection durable, the same way HubSpot/similar tools keep it connected
// indefinitely without the user re-authenticating. Returns expiresIn
// (seconds, ~60 days for a long-lived token) so callers can record when it
// needs renewing rather than finding out only when a call fails.
export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresIn: number | null }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: FB_APP_ID,
    client_secret: FB_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Facebook long-lived token exchange failed: ${await res.text()}`);
  const data = await res.json();
  return { accessToken: data.access_token as string, expiresIn: typeof data.expires_in === "number" ? data.expires_in : null };
}

export type FacebookPage = {
  id: string;
  name: string;
  access_token: string;
  business: { id: string; name: string } | null;
};

export async function fetchUserPages(userAccessToken: string): Promise<FacebookPage[]> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token,business{id,name}&access_token=${encodeURIComponent(
      userAccessToken
    )}`
  );
  if (!res.ok) throw new Error(`Failed to fetch Facebook pages: ${await res.text()}`);
  const data = await res.json();
  const pages = data.data || [];
  // business is omitted entirely (not null) by Graph API when a page isn't
  // under a Business Manager account, or when business_management wasn't
  // actually granted — normalize to null so every caller can treat
  // "ungrouped" the same way instead of checking for undefined too.
  return pages.map((p: Omit<FacebookPage, "business"> & { business?: { id: string; name: string } }) => ({
    ...p,
    business: p.business || null,
  }));
}

// Who this OAuth grant belongs to — fetched once per callback and used to
// label the connected account ("rafid@company.com") and to recognize a
// repeat login of the same Meta identity (see connectedAccounts' unique
// index on externalAccountId in db/schema.ts) so reconnecting or adding
// another Page never creates a duplicate account row.
export async function fetchAccountIdentity(userAccessToken: string): Promise<{ id: string; label: string }> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me?fields=id,name,email&access_token=${encodeURIComponent(userAccessToken)}`
  );
  if (!res.ok) throw new Error(`Failed to fetch Facebook account identity: ${await res.text()}`);
  const data = await res.json();
  // email requires the user to grant the "email" scope (some accounts have
  // no email on file, or decline the prompt) — fall back to their name so
  // the account always has a usable label.
  return { id: data.id, label: data.email || data.name || data.id };
}

export type FacebookLeadForm = { id: string; name: string; status: string };

// Lists every Lead Ad form already created on a page — this is what lets
// the connector show "tick which forms you want connected" instead of
// silently syncing every form on the page. Facebook's page-level leadgen
// webhook subscription (subscribePageToLeadgenWebhook below) can't be
// scoped to individual forms; filtering by form is done on our side (see
// api/webhooks/facebook/route.ts), which is why this list needs to be
// stored, not just displayed once.
export async function fetchPageLeadForms(pageId: string, pageAccessToken: string): Promise<FacebookLeadForm[]> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/leadgen_forms?fields=id,name,status&access_token=${encodeURIComponent(
      pageAccessToken
    )}`
  );
  if (!res.ok) throw new Error(`Failed to fetch lead forms: ${await res.text()}`);
  const data = await res.json();
  return data.data || [];
}

// Tells Facebook to start sending leadgen webhook events for this page to
// our app. Without this, pasting/storing a token alone does nothing.
export async function subscribePageToLeadgenWebhook(pageId: string, pageAccessToken: string) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${encodeURIComponent(
      pageAccessToken
    )}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(`Failed to subscribe page to webhook: ${await res.text()}`);
  return res.json();
}

// A token/permission problem surfaces as a failed Graph API call, not as
// its own event — Facebook doesn't proactively notify you a token expired,
// a permission was revoked, or a Page/form was deleted. Recognizing these
// specific shapes lets the Lead Sources page show "Reconnect Required" or
// "no longer exists" instead of a raw error that could just as easily mean
// a transient outage. Shared by the webhook receiver and the sync-now
// endpoint — both hit the same class of Graph API failures.
//
//   190            = expired/invalid access token
//   10, 200-299    = missing permission (OAuthException subset Meta uses
//                    for "does not have permission" / revoked scopes)
//   803, "does not exist" / "Unsupported get request" = the Page, Business,
//                    or Lead Form itself was removed/deleted on Facebook's
//                    side, not a token problem at all
import type { ProviderErrorKind } from "./lead-sources/provider";

export function classifyFacebookError(err: unknown): ProviderErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  if (/"code"\s*:\s*190/.test(message) || /access token.*expired/i.test(message)) {
    return "token_expired";
  }
  if (/"code"\s*:\s*10\b/.test(message) || /does not have permission/i.test(message) || /"code"\s*:\s*2\d\d\b/.test(message)) {
    return "permission_revoked";
  }
  if (/"code"\s*:\s*803\b/.test(message) || /does not exist/i.test(message) || /Unsupported get request/i.test(message)) {
    return "not_found";
  }
  if (/OAuthException/i.test(message)) return "token_expired";
  return "error";
}

export async function unsubscribePageFromLeadgenWebhook(pageId: string, pageAccessToken: string) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/subscribed_apps?access_token=${encodeURIComponent(pageAccessToken)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`Failed to unsubscribe page from webhook: ${await res.text()}`);
  return res.json();
}
