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
