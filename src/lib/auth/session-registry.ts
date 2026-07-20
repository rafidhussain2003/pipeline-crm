// Enterprise single-device security — the session registry.
//
// The access token is still a stateless JWT (fast, no DB on the hot path most
// of the time), but each one now carries a `sessionId` claim, and only the
// sessionId stored on the user row is alive. Logging in rotates the stored id,
// which instantly strands every previously issued JWT — the "old browser
// becomes unauthorized automatically" requirement — without introducing
// per-request token tables.
//
// The check is a short-TTL cached read (one SELECT per user per 15s worst
// case across all their requests). Rotation deletes the cache key, so on the
// instance that processed the login the old session dies immediately; other
// instances converge within the TTL.
import crypto from "crypto";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { isUndefinedColumn } from "@/lib/db-errors";

const SESSION_CHECK_TTL_MS = 15_000;
const cacheKey = (userId: string) => `current-session:${userId}`;

// Sentinels for the cache (it stores strings): distinguish "user row has no
// session id yet" from "user row is gone".
const NONE = "__none__";
const MISSING = "__missing__";

export async function isSessionCurrent(userId: string, sessionId: string | undefined): Promise<boolean> {
  let current: string;
  try {
    current = await cache.getOrSet(cacheKey(userId), SESSION_CHECK_TTL_MS, async () => {
      const [row] = await db.select({ currentSessionId: users.currentSessionId }).from(users).where(eq(users.id, userId)).limit(1);
      if (!row) return MISSING;
      return row.currentSessionId ?? NONE;
    });
  } catch {
    // Revocation soft-fail: on a transient DB error the JWT itself is still
    // cryptographically valid and short-lived — failing closed here would
    // mass-logout every user on a database blip. Enforcement resumes on the
    // next successful check.
    return true;
  }
  if (current === MISSING) return false;
  // Null column = this user has not logged in since single-device shipped.
  // Their pre-rollout token (no sessionId claim) keeps working until their
  // next login stamps a real id and retires it.
  if (current === NONE) return true;
  return sessionId === current;
}

// Rotate on login (and when a legacy refresh needs an id): the returned id
// goes into the JWT; everything issued before this call stops validating.
export async function activateSession(userId: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  try {
    await db.update(users).set({ currentSessionId: sessionId }).where(eq(users.id, userId));
  } catch (err) {
    // Migration lag (users.current_session_id ships in 0038): a login must
    // not hard-fail because the column isn't there yet. The JWT still
    // carries the id; isSessionCurrent treats the null/absent column as the
    // legacy grace state, and enforcement begins the moment the boot
    // migrator (src/instrumentation.ts) lands the column.
    if (!isUndefinedColumn(err)) throw err;
    console.error("[session-registry] current_session_id column missing — migration 0038 not applied yet; single-device enforcement deferred");
  }
  await cache.delete(cacheKey(userId));
  return sessionId;
}

// Kill every session without blessing a new one — logout, admin-forced
// logout, deactivation. Stores a fresh random id that no JWT has ever seen.
export async function invalidateAllSessions(userId: string): Promise<void> {
  try {
    await db.update(users).set({ currentSessionId: crypto.randomUUID() }).where(eq(users.id, userId));
  } catch (err) {
    // Same migration-lag guard as activateSession — logout still clears
    // cookies and revokes the refresh chain even when this column is absent.
    if (!isUndefinedColumn(err)) throw err;
    console.error("[session-registry] current_session_id column missing — migration 0038 not applied yet; session invalidation deferred");
  }
  await cache.delete(cacheKey(userId));
}
