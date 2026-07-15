// Website Forms security (Phase 8) — origin allow-listing + replay protection.
// Isolated so the public submission endpoint stays thin. Both checks are
// ADDITIVE and backward-compatible: a connection with no allowed domains
// configured accepts any origin (as before), and replay protection only
// engages when the SDK actually supplies a nonce + timestamp.
import type { leadSources } from "@/db/schema";

type Source = typeof leadSources.$inferSelect;

export interface WebsiteConfig {
  allowedDomains: string[];
  captcha?: { provider: string; secret: string };
  replayProtection: boolean;
}

export function getWebsiteConfig(source: Source): WebsiteConfig {
  const m = (source.providerMetadata ?? {}) as {
    allowedDomains?: unknown;
    captcha?: { provider: string; secret: string };
    replayProtection?: boolean;
  };
  const allowedDomains = Array.isArray(m.allowedDomains) ? m.allowedDomains.filter((d): d is string => typeof d === "string" && d.length > 0) : [];
  return { allowedDomains, captcha: m.captcha, replayProtection: m.replayProtection ?? false };
}

function hostOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u.includes("://") ? u : `https://${u}`).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return u.replace(/^www\./i, "").toLowerCase().split("/")[0] || null;
  }
}

// True if the submission's Origin/Referer host matches an allowed domain (or a
// subdomain of it). Empty allow-list → allow everything. Configured but no
// Origin/Referer → block (a real browser always sends one; a server-to-server
// integration should use the secret Webhook Endpoint instead of this).
export function isOriginAllowed(origin: string | null, referer: string | null, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const from = [hostOf(origin), hostOf(referer)].filter((x): x is string => !!x);
  if (from.length === 0) return false;
  const allow = allowedDomains.map(hostOf).filter((x): x is string => !!x);
  return from.some((c) => allow.some((a) => c === a || c.endsWith(`.${a}`)));
}

// ── Replay protection ──────────────────────────────────────────────────────
// A submission carries a client nonce + timestamp (via the SDK's _meta). We
// reject a stale timestamp and any nonce we've already seen within the window.
// In-memory (per instance) — fine for the intended abuse (a captured request
// re-fired); the Redis-backed version swaps behind this same function later.
const MAX_AGE_MS = 10 * 60_000;
const MAX_SKEW_MS = 2 * 60_000;
const seen = new Map<string, number>(); // key -> expiresAt

setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of seen) if (exp < now) seen.delete(k);
}, 60_000).unref?.();

export function checkReplay(sourceId: string, nonce: string | null, timestampMs: number | null): { ok: boolean; reason?: string } {
  if (!nonce || !timestampMs) return { ok: true }; // only enforced when both are supplied
  const now = Date.now();
  if (timestampMs < now - MAX_AGE_MS) return { ok: false, reason: "stale" };
  if (timestampMs > now + MAX_SKEW_MS) return { ok: false, reason: "future_timestamp" };
  const key = `${sourceId}:${nonce}`;
  if (seen.has(key)) return { ok: false, reason: "replayed" };
  seen.set(key, now + MAX_AGE_MS);
  return { ok: true };
}
