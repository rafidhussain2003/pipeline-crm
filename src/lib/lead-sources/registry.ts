import type { LeadSourceProvider } from "./provider";
import { metaProvider } from "./providers/meta";

// Every OAuth-based lead-source integration this app knows about. Adding a
// real Google/TikTok/LinkedIn provider later means writing
// providers/<name>.ts implementing LeadSourceProvider and adding one line
// here — nothing else (routes, the webhook receiver, the Lead Sources
// page's connection-management logic) needs to change. Platforms with no
// entry here (google, tiktok, linkedin...) are exactly the ones shown as
// "Coming Soon" on the Lead Sources page.
const PROVIDERS: Record<string, LeadSourceProvider> = {
  facebook: metaProvider,
};

export function getProvider(platform: string): LeadSourceProvider | null {
  return PROVIDERS[platform] || null;
}
