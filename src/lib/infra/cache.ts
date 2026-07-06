// Cache abstraction. The interface is deliberately small (get/set/delete/
// getOrSet) — the subset every real cache backend (Redis, Memcached,
// in-memory) can implement identically, so call sites never need to change
// when the backend does.
//
// Today's implementation is a plain in-memory Map with TTL, scoped to a
// single process (same caveat as src/lib/rate-limit.ts). When Redis is
// provisioned, swap `cache` below for a Redis-backed implementation of the
// same `Cache` interface — no call site changes required.
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  // Cache-aside helper: return the cached value, or compute it via `fn`,
  // cache it, and return it. This is the pattern every call site should
  // use — it's the one thing hand-rolled caching most often gets wrong
  // (forgetting to cache on miss, or double-computing under a race).
  getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>;
  stats(): { hits: number; misses: number; size: number };
}

type Entry = { value: unknown; expiresAt: number };

class InMemoryCache implements Cache {
  private store = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;

  constructor() {
    // Periodic cleanup, same pattern as rate-limit.ts, so this Map doesn't
    // grow unbounded over a long-running process.
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (entry.expiresAt < now) this.store.delete(key);
      }
    }, 60_000).unref?.();
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async getOrSet<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await fn();
    await this.set(key, value, ttlMs);
    return value;
  }

  stats() {
    return { hits: this.hits, misses: this.misses, size: this.store.size };
  }
}

export const cache: Cache = new InMemoryCache();
