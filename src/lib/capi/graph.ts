// Phase 11 — the thin Graph API layer for Conversions API: discovery (list a
// connected Meta account's businesses / ad accounts / pixels for the selection
// UI) and the event send itself. All calls reuse the connected account's OAuth
// token — no separate Meta login. Kept isolated from the Lead Ads Graph helpers
// (lib/facebook-oauth.ts) so this phase never touches that working code.
const GRAPH_VERSION = "v19.0";
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphGet<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Graph GET ${path} failed: ${await res.text()}`);
  return res.json();
}

export type IdName = { id: string; name: string };
export type PixelInfo = { id: string; name: string };

export async function listBusinesses(token: string): Promise<IdName[]> {
  const data = await graphGet<{ data?: IdName[] }>("me/businesses?fields=id,name&limit=100", token);
  return data.data || [];
}

// Ad accounts, optionally scoped to a business. Falls back to the user's own
// ad accounts when no business is given.
export async function listAdAccounts(token: string, businessId?: string | null): Promise<IdName[]> {
  if (businessId) {
    const [owned, client] = await Promise.all([
      graphGet<{ data?: { id: string; name: string }[] }>(`${businessId}/owned_ad_accounts?fields=id,name&limit=200`, token).catch(() => ({ data: [] })),
      graphGet<{ data?: { id: string; name: string }[] }>(`${businessId}/client_ad_accounts?fields=id,name&limit=200`, token).catch(() => ({ data: [] })),
    ]);
    const merged = [...(owned.data || []), ...(client.data || [])];
    const seen = new Set<string>();
    return merged.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  }
  const data = await graphGet<{ data?: { id: string; name: string }[] }>("me/adaccounts?fields=id,name&limit=200", token);
  return data.data || [];
}

// Pixels (a.k.a. datasets) under an ad account. `adAccountId` is the act_… id.
export async function listPixels(token: string, adAccountId: string): Promise<PixelInfo[]> {
  const data = await graphGet<{ data?: PixelInfo[] }>(`${adAccountId}/adspixels?fields=id,name&limit=100`, token);
  return data.data || [];
}

export interface SendResult {
  ok: boolean;
  httpStatus: number;
  response: unknown;
  eventsReceived: number | null;
  error: string | null;
  fbtraceId: string | null;
}

// POST conversion events to /{pixelId}/events. Returns a structured result
// (never throws) so the queue worker can record status/response and decide
// retry vs dead-letter.
export async function sendEvents(pixelId: string, token: string, events: unknown[], testEventCode?: string | null): Promise<SendResult> {
  try {
    const body: Record<string, unknown> = { data: events, access_token: token };
    if (testEventCode) body.test_event_code = testEventCode;
    const res = await fetch(`${BASE}/${pixelId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    const fbtraceId = (json?.fbtrace_id as string) || null;
    if (!res.ok) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      return { ok: false, httpStatus: res.status, response: json, eventsReceived: null, error: String(msg), fbtraceId };
    }
    return { ok: true, httpStatus: res.status, response: json, eventsReceived: typeof json?.events_received === "number" ? json.events_received : null, error: null, fbtraceId };
  } catch (err) {
    // Network/transport error — retryable.
    return { ok: false, httpStatus: 0, response: null, eventsReceived: null, error: err instanceof Error ? err.message : String(err), fbtraceId: null };
  }
}
