// The common shape every OAuth-based lead-source integration implements —
// Meta today, Google/TikTok/LinkedIn later (see README's "Adding a new
// Lead Source provider" section). Adding a new provider means writing one
// file that implements this interface and registering it in registry.ts;
// nothing else in the app (routes, the webhook receiver, the Lead Sources
// UI) needs to change.
//
// Deliberately does NOT cover the Universal Webhook mechanism (platform
// "generic"/"google" via /api/lead-sources) — that has no OAuth, no
// "business/page/form" concept, and no provider-side API to adapt; it's a
// fundamentally different shape (an inbound POST endpoint with a shared
// secret), not a leaky variant of this interface.
export type ProviderBusiness = { id: string; name: string } | null;

// "Container" = the thing a lead form lives under (a Facebook Page, a
// Google Ads account, a TikTok Business Center asset...) — kept
// provider-neutral rather than called "page" here, even though Meta is the
// only real implementation today.
export type ProviderContainer = {
  id: string;
  name: string;
  accessToken: string;
  business: ProviderBusiness;
};

export type ProviderForm = { id: string; name: string; status?: string };

export type ProviderLead = { name: string; phone: string | null; email: string | null; raw: unknown };

export type ProviderErrorKind = "token_expired" | "permission_revoked" | "not_found" | "error";

export interface LeadSourceProvider {
  readonly platform: string; // matches sourcePlatformEnum, e.g. "facebook"
  readonly displayName: string; // "Meta Lead Ads"

  getAuthorizeUrl(redirectUri: string, state: string): string;

  exchangeCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<{ accessToken: string; expiresIn: number | null }>;

  // Who this OAuth grant belongs to — used to label a connectedAccounts
  // row ("rafid@company.com") and to recognize a repeat login of the same
  // identity so it's never duplicated (see connectedAccounts in
  // db/schema.ts and its unique index on (companyId, platform,
  // externalAccountId)).
  fetchAccountIdentity(accessToken: string): Promise<{ id: string; label: string }>;

  // Everything the authorized account gives access to (Meta: Pages, each
  // with which Business Manager it belongs to). The OAuth callback holds
  // this list in a short-lived signed cookie until the admin picks one.
  listContainers(accessToken: string): Promise<ProviderContainer[]>;

  listForms(containerId: string, containerAccessToken: string): Promise<ProviderForm[]>;

  subscribeWebhook(containerId: string, containerAccessToken: string): Promise<void>;
  unsubscribeWebhook(containerId: string, containerAccessToken: string): Promise<void>;

  fetchLead(externalLeadId: string, containerAccessToken: string): Promise<ProviderLead>;

  // Recognizes a provider's own error shapes (Meta's OAuthException code
  // 190, a removed-page 404, etc.) so the UI can show "Reconnect Required"
  // instead of a raw API error — see lib/lead-sources/registry.ts's
  // consumers for where this drives status.
  classifyError(err: unknown): ProviderErrorKind;
}
