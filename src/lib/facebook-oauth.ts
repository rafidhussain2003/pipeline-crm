const GRAPH_VERSION = "v19.0";
const FB_APP_ID = process.env.FACEBOOK_APP_ID || "";
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";

// Name of the short-lived httpOnly cookie that temporarily holds fetched
// page tokens between the OAuth callback and the admin picking which pages
// to connect (see /api/oauth/facebook/callback and /api/lead-sources/facebook/*).
export const PENDING_PAGES_COOKIE = "fb_pending_pages";

// Scopes needed to: list the pages a user manages, read their lead forms,
// and keep reading page info/engagement for the connector UI.
const SCOPES = ["pages_show_list", "pages_manage_metadata", "leads_retrieval", "pages_read_engagement"].join(",");

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
// indefinitely without the user re-authenticating.
export async function exchangeForLongLivedToken(shortLivedToken: string) {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: FB_APP_ID,
    client_secret: FB_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Facebook long-lived token exchange failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

export type FacebookPage = { id: string; name: string; access_token: string };

export async function fetchUserPages(userAccessToken: string): Promise<FacebookPage[]> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(
      userAccessToken
    )}`
  );
  if (!res.ok) throw new Error(`Failed to fetch Facebook pages: ${await res.text()}`);
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
