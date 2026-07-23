/**
 * In-memory sliding-window rate limiter. This is deliberately simple and
 * works well for a single Render web service instance (the deployment
 * target this app was built for). If this app is ever scaled to multiple
 * instances behind a load balancer, swap the Map below for a Redis-backed
 * counter (e.g. `INCR` + `EXPIRE`) so limits are shared across instances —
 * the call sites (`checkRateLimit`) would not need to change.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Periodic cleanup so this Map doesn't grow unbounded over a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 60_000).unref?.();

export function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count };
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * Centralized rate-limit policies. Routes call `checkPolicy(category, id)`
 * instead of hardcoding `checkRateLimit(key, limit, windowMs)` inline, so
 * every category's limit lives in one place instead of being scattered
 * (and easy to lose track of) across ~30 route files.
 *
 * This still runs on the in-memory `checkRateLimit` above — no Redis yet,
 * as instructed. When Redis is introduced later, only `checkPolicy`'s
 * internals need to change; every call site stays the same.
 */
export type RateLimitCategory =
  | "auth.login"
  | "auth.signup"
  | "auth.password_reset" // reserved: no password-reset endpoint exists yet
  | "auth.password_change"
  | "webhook.generic"
  | "forms.submit"
  | "forms.submit.ip"
  | "webhook.facebook"
  | "oauth.facebook"
  | "lead_sources.account_sync"
  | "api.public"
  | "api.authenticated"
  | "api.admin"
  | "api.super_admin";

const POLICIES: Record<RateLimitCategory, { limit: number; windowMs: number }> = {
  "auth.login": { limit: 10, windowMs: 60_000 },
  "auth.signup": { limit: 5, windowMs: 60_000 },
  "auth.password_reset": { limit: 5, windowMs: 60_000 },
  "auth.password_change": { limit: 5, windowMs: 60_000 },
  "webhook.generic": { limit: 60, windowMs: 60_000 },
  // Website form submissions come straight from visitor browsers, so they're
  // rate-limited on two axes: per-form (a busy landing page can legitimately
  // convert fast — generous) and per-IP-per-form (one browser hammering a
  // form is almost certainly a bot/abuse — tight). Both must pass.
  "forms.submit": { limit: 300, windowMs: 60_000 },
  "forms.submit.ip": { limit: 10, windowMs: 60_000 },
  // Facebook's own leadgen delivery rate for a single app is nowhere near
  // this; it's set high enough to only catch actual abuse, not throttle
  // real webhook traffic.
  "webhook.facebook": { limit: 300, windowMs: 60_000 },
  "oauth.facebook": { limit: 20, windowMs: 60_000 },
  "lead_sources.account_sync": { limit: 20, windowMs: 60_000 },
  "api.public": { limit: 60, windowMs: 60_000 },
  "api.authenticated": { limit: 120, windowMs: 60_000 },
  "api.admin": { limit: 30, windowMs: 60_000 },
  "api.super_admin": { limit: 10, windowMs: 60_000 },
};

export function checkPolicy(category: RateLimitCategory, identifier: string): { allowed: boolean; remaining: number } {
  const policy = POLICIES[category];
  return checkRateLimit(`${category}:${identifier}`, policy.limit, policy.windowMs);
}

/**
 * Per-account login lockout — complements the IP-based rate limit above.
 * IP limiting stops one IP from hammering many accounts; this stops one
 * account from being brute-forced across many IPs. Same in-memory,
 * single-instance approach as the rest of this file (see note at top).
 */
type LockoutEntry = { failures: number; lockedUntil: number | null; lastFailureAt: number };
const lockouts = new Map<string, LockoutEntry>();

const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_DURATION_MS = 15 * 60_000; // 15 minutes
const FAILURE_MEMORY_MS = 60 * 60_000; // a failure this old no longer counts toward the threshold

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of lockouts) {
    const stillLocked = entry.lockedUntil !== null && entry.lockedUntil > now;
    const failureStillCounts = now - entry.lastFailureAt < FAILURE_MEMORY_MS;
    if (!stillLocked && !failureStillCounts) lockouts.delete(key);
  }
}, 60_000).unref?.();

export function checkAccountLockout(key: string): { locked: boolean; retryAfterMs: number } {
  const entry = lockouts.get(key);
  if (!entry || entry.lockedUntil === null || entry.lockedUntil <= Date.now()) {
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: entry.lockedUntil - Date.now() };
}

// Returns whether THIS failure tripped the lockout, so the caller can record
// one "account.locked" security event at the moment it happens.
export function recordLoginFailure(key: string): { lockedNow: boolean } {
  const now = Date.now();
  const entry = lockouts.get(key);
  if (entry && now - entry.lastFailureAt < FAILURE_MEMORY_MS) {
    entry.failures += 1;
    entry.lastFailureAt = now;
    if (entry.failures >= MAX_LOGIN_FAILURES && (entry.lockedUntil === null || entry.lockedUntil <= now)) {
      entry.lockedUntil = now + LOCKOUT_DURATION_MS;
      return { lockedNow: true };
    }
  } else {
    lockouts.set(key, { failures: 1, lockedUntil: null, lastFailureAt: now });
  }
  return { lockedNow: false };
}

export function recordLoginSuccess(key: string): void {
  lockouts.delete(key);
}

/** Currently locked accounts — Security dashboard use. */
export function listActiveLockouts(): { key: string; failures: number; lockedUntilIso: string }[] {
  const now = Date.now();
  const out: { key: string; failures: number; lockedUntilIso: string }[] = [];
  for (const [key, entry] of lockouts) {
    if (entry.lockedUntil !== null && entry.lockedUntil > now) {
      out.push({ key, failures: entry.failures, lockedUntilIso: new Date(entry.lockedUntil).toISOString() });
    }
  }
  return out;
}
