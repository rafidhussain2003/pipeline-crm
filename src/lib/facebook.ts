const GRAPH_VERSION = "v19.0";

type FbFieldData = { name: string; values: string[] };

function parseLeadFields(data: { field_data?: FbFieldData[] }) {
  const fieldData = data.field_data || [];
  const get = (key: string) => fieldData.find((f) => f.name.toLowerCase().includes(key))?.values?.[0];
  return {
    name: get("full_name") || get("name") || [get("first_name"), get("last_name")].filter(Boolean).join(" ") || null,
    phone: get("phone") || null,
    email: get("email") || null,
  };
}

export async function fetchFacebookLead(leadgenId: string, pageAccessToken: string) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?access_token=${encodeURIComponent(
    pageAccessToken
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Facebook Graph API error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { ...parseLeadFields(data), raw: data };
}

// --- Rate-limit-aware fetch for bulk Graph API calls (the historical
// importer) ---
//
// A single ad-hoc webhook fetch rarely trips Meta's rate limiter; a bulk
// import making hundreds/thousands of paginated calls in a row is exactly
// the traffic shape Meta throttles. Exponential backoff, capped retries —
// never hammers the API, and gives up (surfacing the real error) rather
// than retrying forever.
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60_000;

// Meta's own throttling ("Application/User request limit reached") arrives
// as an OAuthException-shaped body with one of these codes, not
// necessarily a 429 status — the body has to be inspected either way.
function isRateLimitError(status: number, body: string): boolean {
  if (status === 429) return true;
  return /"code"\s*:\s*(4|17|32|613)\b/.test(body);
}

async function fetchWithBackoff(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    const body = await res.text();
    if (res.ok) return body;
    if (attempt < MAX_RETRIES && isRateLimitError(res.status, body)) {
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    throw new Error(`Facebook Graph API error: ${res.status} ${body}`);
  }
}

export type FbHistoricalLead = {
  leadgenId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  raw: unknown;
};

// Meta's historical Lead Ads retrieval endpoint — GET /{form-id}/leads,
// cursor-paginated, optionally filtered to leads created after a given
// Unix timestamp. Unlike the single-lead fetch above (used by the live
// webhook, which only ever gets a bare leadgen_id and must fetch the real
// data separately), this returns full lead data inline — the historical
// importer never needs a second per-lead API call.
export async function fetchFormLeads(
  formId: string,
  pageAccessToken: string,
  opts: { sinceUnix?: number | null; after?: string | null; limit?: number } = {}
): Promise<{ leads: FbHistoricalLead[]; nextCursor: string | null }> {
  const params = new URLSearchParams({
    access_token: pageAccessToken,
    fields: "id,created_time,field_data",
    limit: String(opts.limit ?? 100),
  });
  if (opts.after) params.set("after", opts.after);
  if (opts.sinceUnix) {
    params.set("filtering", JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: opts.sinceUnix }]));
  }

  const body = await fetchWithBackoff(`https://graph.facebook.com/${GRAPH_VERSION}/${formId}/leads?${params.toString()}`);
  const data = JSON.parse(body);
  const items = (data.data || []) as Array<{ id: string; field_data?: FbFieldData[] }>;

  return {
    leads: items.map((item) => ({ leadgenId: item.id, ...parseLeadFields(item), raw: item })),
    // Meta includes a `next` link only when another page actually exists —
    // a cursor value can be present even on the last page without one.
    nextCursor: data.paging?.next ? data.paging?.cursors?.after ?? null : null,
  };
}
