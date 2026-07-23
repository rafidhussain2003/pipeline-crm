// Abuse guard — bot/spam/brute-force heuristics for the authentication
// surfaces. In-memory sliding windows, same single-instance deliberation as
// src/lib/rate-limit.ts (swap for Redis if this app ever runs multi-instance;
// call sites won't change).
//
// Built against an attack observed IN PRODUCTION: bots feeding the signup
// verification endpoint dotted-Gmail variants (4.4.or.a.nge4.4@gmail.com…)
// and disposable domains, each variant a "fresh" email with its own resend
// budget — burning the Resend quota one delivered code at a time. The
// email-identity normalization below is what kills that class: every dotted/
// plus-tagged variant of a Gmail address collapses to ONE identity for every
// cap and counter here.
import { checkRateLimit } from "@/lib/rate-limit";

// --- Email identity -------------------------------------------------------

// Domains where dots in the local part are ignored by the provider.
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

// A modest, high-signal set of throwaway-email providers. Not exhaustive —
// the caps below still bound anything that slips through — but each entry
// here costs an attacker a working mailbox instead of a free one.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com",
  "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io",
  "yopmail.com", "yopmail.net", "getnada.com", "dispostable.com", "trashmail.com",
  "fakeinbox.com", "mailnesia.com", "maildrop.cc", "spamgourmet.com", "mytemp.email",
  "throwawaymail.com", "emailondeck.com", "mohmal.com", "tempinbox.com", "mintemail.com",
  "web-library.net", "mailsac.com", "inboxkitten.com", "tempr.email", "burnermail.io",
]);

/**
 * Collapse an email to the identity its provider actually delivers to:
 * lowercase, +tag stripped, and (for Gmail) dots in the local part removed.
 * Every rate cap and abuse counter keys on THIS, never the raw string.
 */
export function normalizeEmailIdentity(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (DOT_INSENSITIVE_DOMAINS.has(domain)) local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function isDisposableEmailDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  return at >= 0 && DISPOSABLE_DOMAINS.has(email.slice(at + 1).trim().toLowerCase());
}

// --- Windowed trackers ----------------------------------------------------

type WindowEntry = { items: Map<string, number>; resetAt: number };

/** Tracks DISTINCT values per key inside a rolling window. */
class DistinctTracker {
  private store = new Map<string, WindowEntry>();
  constructor(private windowMs: number) {}
  add(key: string, value: string): number {
    const now = Date.now();
    let entry = this.store.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { items: new Map(), resetAt: now + this.windowMs };
      this.store.set(key, entry);
    }
    entry.items.set(value, now);
    return entry.items.size;
  }
  sweep(): void {
    const now = Date.now();
    for (const [k, e] of this.store) if (e.resetAt < now) this.store.delete(k);
  }
}

// One identity showing up under many raw spellings = the dotted-Gmail bot.
const variantsPerIdentity = new DistinctTracker(24 * 60 * 60_000);
// One IP requesting codes for many identities = spraying / stuffing.
const identitiesPerIp = new DistinctTracker(60 * 60_000);
// Many IPs hitting one account's login = distributed brute force.
const ipsPerLoginTarget = new DistinctTracker(60 * 60_000);

const VARIANTS_BOT_THRESHOLD = 3; // >3 spellings of one identity in a day
const IDENTITY_FANOUT_THRESHOLD = 10; // >10 distinct emails from one IP in an hour
const DISTRIBUTED_TARGET_THRESHOLD = 5; // >5 IPs failing on one account in an hour

// --- Progressive temporary IP blocking ------------------------------------

type BlockEntry = { until: number; offenses: number };
const blockedIps = new Map<string, BlockEntry>();
const strikeWindows = new Map<string, { count: number; resetAt: number }>();

const STRIKE_WINDOW_MS = 15 * 60_000;
const STRIKES_TO_BLOCK = 20;
const BASE_BLOCK_MS = 15 * 60_000;
const MAX_BLOCK_MS = 24 * 60 * 60_000; // never longer than a day, never permanent
const OFFENSE_MEMORY_MS = 48 * 60 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of blockedIps) if (b.until < now && now - b.until > OFFENSE_MEMORY_MS) blockedIps.delete(ip);
  for (const [ip, s] of strikeWindows) if (s.resetAt < now) strikeWindows.delete(ip);
  variantsPerIdentity.sweep();
  identitiesPerIp.sweep();
  ipsPerLoginTarget.sweep();
}, 60_000).unref?.();

export function isIpBlocked(ip: string): { blocked: boolean; retryAfterMs: number } {
  const entry = blockedIps.get(ip);
  if (!entry || entry.until <= Date.now()) return { blocked: false, retryAfterMs: 0 };
  return { blocked: true, retryAfterMs: entry.until - Date.now() };
}

/**
 * Count a malicious-looking request against an IP. At STRIKES_TO_BLOCK
 * within the window the IP gets a temporary block whose duration doubles
 * with each repeat offense (15m → 30m → 1h … capped at 24h). Returns
 * whether THIS strike started a block, so the caller can log one
 * "ip.blocked" event instead of twenty.
 */
export function recordStrike(ip: string, weight = 1): { blockedNow: boolean; blockMs: number } {
  if (!ip || ip === "unknown") return { blockedNow: false, blockMs: 0 };
  const now = Date.now();
  let win = strikeWindows.get(ip);
  if (!win || win.resetAt < now) {
    win = { count: 0, resetAt: now + STRIKE_WINDOW_MS };
    strikeWindows.set(ip, win);
  }
  win.count += weight;
  if (win.count < STRIKES_TO_BLOCK) return { blockedNow: false, blockMs: 0 };

  win.count = 0; // the block consumes the strikes
  const prior = blockedIps.get(ip);
  const offenses = (prior?.offenses ?? 0) + 1;
  const blockMs = Math.min(BASE_BLOCK_MS * 2 ** (offenses - 1), MAX_BLOCK_MS);
  blockedIps.set(ip, { until: now + blockMs, offenses });
  return { blockedNow: true, blockMs };
}

// --- OTP send caps ---------------------------------------------------------

// Layered ABOVE the verification lib's own 60s cooldown + 5-resend budget
// (which are per exact email+purpose): these are per normalized identity and
// per IP, per hour — so no amount of respelling or purpose-hopping mints
// extra email.
const OTP_PER_IDENTITY_HOURLY = 6;
const OTP_PER_IP_HOURLY = 12;
const OTP_PER_IP_BURST = 5; // per 5 minutes

export type OtpGateResult =
  | { allowed: true }
  | { allowed: false; reason: "identity_hourly_cap" | "ip_hourly_cap" | "ip_burst_cap" | "disposable_domain" | "variant_abuse" };

/**
 * Decide whether an OTP email may be SENT for this (email, ip). Callers must
 * respond identically whether or not the send happens — the caller keeps the
 * response generic; this only gates the outbound email + records signals.
 */
export function otpSendAllowed(email: string, ip: string): OtpGateResult {
  const identity = normalizeEmailIdentity(email);

  if (isDisposableEmailDomain(email)) return { allowed: false, reason: "disposable_domain" };
  if (variantsPerIdentity.add(identity, email.trim().toLowerCase()) > VARIANTS_BOT_THRESHOLD) {
    return { allowed: false, reason: "variant_abuse" };
  }
  if (!checkRateLimit(`otp.identity:${identity}`, OTP_PER_IDENTITY_HOURLY, 60 * 60_000).allowed) {
    return { allowed: false, reason: "identity_hourly_cap" };
  }
  if (!checkRateLimit(`otp.ip.burst:${ip}`, OTP_PER_IP_BURST, 5 * 60_000).allowed) {
    return { allowed: false, reason: "ip_burst_cap" };
  }
  if (!checkRateLimit(`otp.ip:${ip}`, OTP_PER_IP_HOURLY, 60 * 60_000).allowed) {
    return { allowed: false, reason: "ip_hourly_cap" };
  }
  return { allowed: true };
}

/** Bot-pattern bookkeeping for OTP-requesting endpoints. */
export function trackOtpFanout(email: string, ip: string): { fanout: number; suspicious: boolean } {
  const fanout = identitiesPerIp.add(ip, normalizeEmailIdentity(email));
  return { fanout, suspicious: fanout > IDENTITY_FANOUT_THRESHOLD };
}

/** Distributed brute-force bookkeeping for the login endpoint. */
export function trackLoginTarget(email: string, ip: string): { distinctIps: number; suspicious: boolean } {
  const distinctIps = ipsPerLoginTarget.add(normalizeEmailIdentity(email), ip);
  return { distinctIps, suspicious: distinctIps > DISTRIBUTED_TARGET_THRESHOLD };
}

// --- Dashboard snapshot ----------------------------------------------------

export function getBlockedIpsSnapshot(): { ip: string; untilIso: string; offenses: number }[] {
  const now = Date.now();
  const out: { ip: string; untilIso: string; offenses: number }[] = [];
  for (const [ip, b] of blockedIps) {
    if (b.until > now) out.push({ ip, untilIso: new Date(b.until).toISOString(), offenses: b.offenses });
  }
  return out.sort((a, b) => (a.untilIso < b.untilIso ? 1 : -1));
}
