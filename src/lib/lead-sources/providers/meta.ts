// Meta's implementation of LeadSourceProvider — a thin adapter over the
// existing, already-working Graph API functions in lib/facebook-oauth.ts
// and lib/facebook.ts. No Graph API logic lives here; this file only
// reshapes those functions' inputs/outputs to match the common interface,
// per "reuse everything that already works, don't duplicate OAuth/webhook
// logic."
import type { LeadSourceProvider, ProviderContainer } from "../provider";
import {
  getFacebookAuthorizeUrl,
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  fetchAccountIdentity,
  fetchUserPages,
  fetchPageLeadForms,
  subscribePageToLeadgenWebhook,
  unsubscribePageFromLeadgenWebhook,
  classifyFacebookError,
} from "../../facebook-oauth";
import { fetchFacebookLead } from "../../facebook";

export const metaProvider: LeadSourceProvider = {
  platform: "facebook",
  displayName: "Meta Lead Ads",

  getAuthorizeUrl: getFacebookAuthorizeUrl,

  async exchangeCodeForToken(code, redirectUri) {
    const shortLived = await exchangeCodeForUserToken(code, redirectUri);
    return exchangeForLongLivedToken(shortLived);
  },

  fetchAccountIdentity,

  async listContainers(accessToken): Promise<ProviderContainer[]> {
    const pages = await fetchUserPages(accessToken);
    return pages.map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token, business: p.business }));
  },

  async listForms(containerId, containerAccessToken) {
    return fetchPageLeadForms(containerId, containerAccessToken);
  },

  subscribeWebhook: subscribePageToLeadgenWebhook,
  unsubscribeWebhook: unsubscribePageFromLeadgenWebhook,

  async fetchLead(externalLeadId, containerAccessToken) {
    const lead = await fetchFacebookLead(externalLeadId, containerAccessToken);
    return { name: lead.name || "Unknown", phone: lead.phone ?? null, email: lead.email ?? null, raw: lead.raw };
  },

  classifyError: classifyFacebookError,
};
