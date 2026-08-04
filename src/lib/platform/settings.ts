// Platform Settings — read/write access to the GLOBAL platform_settings
// key/value store (migration 0051). These are platform-owner knobs that are
// NOT per company; the per-company feature flags live elsewhere
// (src/lib/features). Today the only setting is the agent lead-visibility cap.
//
// Reads are cached (short TTL) and schema-lag-safe: if the table hasn't been
// created yet (0051 not applied on this instance), the reader quietly returns
// the built-in default instead of throwing — the exact pattern the security
// events + privacy-mode getters use, so a mid-deploy instance never 500s.
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { isSchemaLagError } from "@/lib/db-errors";

// ── Agent lead-visibility cap ────────────────────────────────────────────
// How many of their most-recently-assigned leads an agent may see in their
// CRM. Older assigned leads are hidden from the agent (never deleted; admins
// and managers still see the full history). The Platform Owner changes this
// in Platform Settings.
export const AGENT_LEAD_CAP_KEY = "agent_lead_visibility_limit";
export const DEFAULT_AGENT_LEAD_CAP = 400;
// Guardrails on what the owner can set: never 0 (would blind every agent),
// never so large it defeats the purpose / hurts query planning.
export const MIN_AGENT_LEAD_CAP = 50;
export const MAX_AGENT_LEAD_CAP = 100_000;

const CACHE_TTL_MS = 60_000;
const cacheKey = (key: string) => `platform_setting:${key}`;

// Raw string value for a key, or null if unset / table missing. Cached.
export async function getPlatformSetting(key: string): Promise<string | null> {
  return cache.getOrSet(cacheKey(key), CACHE_TTL_MS, async () => {
    try {
      const [row] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, key))
        .limit(1);
      return row?.value ?? null;
    } catch (err) {
      // Table not there yet (mid-deploy) → behave as "unset", let callers
      // fall back to their default. Anything else is a real error.
      if (isSchemaLagError(err)) return null;
      throw err;
    }
  });
}

export function clampAgentLeadCap(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_AGENT_LEAD_CAP;
  return Math.min(MAX_AGENT_LEAD_CAP, Math.max(MIN_AGENT_LEAD_CAP, Math.floor(n)));
}

// The effective cap: the configured value clamped to the guardrails, or the
// default when unset / unparseable / the table is missing.
export async function getAgentLeadVisibilityCap(): Promise<number> {
  const raw = await getPlatformSetting(AGENT_LEAD_CAP_KEY);
  if (raw === null) return DEFAULT_AGENT_LEAD_CAP;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_AGENT_LEAD_CAP;
  return clampAgentLeadCap(n);
}

// Upsert the cap (super-admin only, enforced at the route). Returns the value
// actually stored (post-clamp) so the caller can echo/audit the real number.
export async function setAgentLeadVisibilityCap(value: number, userId: string): Promise<number> {
  const clamped = clampAgentLeadCap(value);
  await db
    .insert(platformSettings)
    .values({ key: AGENT_LEAD_CAP_KEY, value: String(clamped), updatedBy: userId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value: String(clamped), updatedBy: userId, updatedAt: new Date() },
    });
  await cache.delete(cacheKey(AGENT_LEAD_CAP_KEY));
  return clamped;
}
