// Phase 11 — Event Match Quality (EMQ) ESTIMATE. Meta computes the authoritative
// EMQ server-side in Events Manager; this is a local, transparent estimate of
// match-parameter coverage so admins get instant feedback (and improvement
// tips) without waiting on Meta's dashboard. Weighted by how strongly each
// parameter identifies a person (email/phone/click-ids strongest).
export type EmqRating = "excellent" | "good" | "fair" | "poor";

const WEIGHTS: Record<string, number> = {
  em: 3, ph: 3, fbc: 3, external_id: 2, fbp: 2,
  fn: 1, ln: 1, ct: 1, st: 1, zp: 1, country: 1,
  client_ip_address: 1, client_user_agent: 1,
};

export function rateEmq(matchKeys: string[]): { rating: EmqRating; score: number; recommendations: string[] } {
  const set = new Set(matchKeys);
  const score = matchKeys.reduce((s, k) => s + (WEIGHTS[k] ?? 0), 0);
  const hasEmail = set.has("em");
  const hasPhone = set.has("ph");
  const hasClickId = set.has("fbc") || set.has("fbp");

  let rating: EmqRating;
  if (hasEmail && hasPhone && (hasClickId || set.has("external_id")) && score >= 9) rating = "excellent";
  else if ((hasEmail || hasPhone) && score >= 5) rating = "good";
  else if (hasEmail || hasPhone) rating = "fair";
  else rating = "poor";

  const recommendations: string[] = [];
  if (!hasEmail) recommendations.push("Collect email addresses — the single strongest match signal.");
  if (!hasPhone) recommendations.push("Collect phone numbers to raise match quality.");
  if (!hasClickId) recommendations.push("Install the Meta Pixel on your site so events carry fbc/fbp click IDs.");
  if (!set.has("external_id")) recommendations.push("Send a stable external ID (the CRM lead id) for better dedup + match.");
  if (!set.has("ct") && !set.has("zp")) recommendations.push("Capture location (city/state/ZIP) to add match signals.");

  return { rating, score, recommendations };
}

// Aggregate rating over a set of recent events (for the Diagnostics page).
export function aggregateEmq(ratings: EmqRating[]): EmqRating {
  if (ratings.length === 0) return "poor";
  const rank: Record<EmqRating, number> = { poor: 0, fair: 1, good: 2, excellent: 3 };
  const avg = ratings.reduce((s, r) => s + rank[r], 0) / ratings.length;
  return avg >= 2.5 ? "excellent" : avg >= 1.5 ? "good" : avg >= 0.5 ? "fair" : "poor";
}
