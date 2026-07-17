// Phase 17 — Progressive Lead Release configuration. Same jsonb-over-defaults
// pattern as the AI scoring config (../ai/config.ts): defaults live here in
// code, a per-company override is stored as automation_settings.
// progressive_config and merged on read, so new knobs never need a migration.
//
// The feature ships OFF: a company that never touches the settings gets the
// existing assignment engine byte-for-byte.
import { db } from "@/db";
import { automationSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { tierEnum } from "@/db/schema";

export type TierName = (typeof tierEnum.enumValues)[number]; // "1" | "2" | "3" | "senior" | "supervisor"

export interface ProgressiveReleaseConfig {
  // Master switch. OFF = the existing sweep drains the queue exactly as today.
  enabled: boolean;
  // Minutes between release cycles. The cron tick (1 min) is the resolution
  // floor, so the allowed values are 1 / 2 / 3 / 5 / 10.
  releaseIntervalMinutes: number;
  // 0–90. The share of a wave's initial backlog held back from early agents;
  // it unlocks proportionally as more of the company's agents come online
  // (see engine.ts for the exact formula — deterministic, never random).
  reservedBacklogPercent: number;
  // Leads released to one agent per cycle, by their tier.
  batchSizePerTier: Record<TierName, number>;
  // Company-wide hard cap on OPEN leads per agent. An agent at/over the cap is
  // skipped until they close something. Null = no cap.
  maxActiveLeads: number | null;
}

export const DEFAULT_PROGRESSIVE_CONFIG: ProgressiveReleaseConfig = {
  enabled: false,
  releaseIntervalMinutes: 2,
  reservedBacklogPercent: 50,
  batchSizePerTier: { "1": 1, "2": 2, "3": 3, senior: 4, supervisor: 4 },
  maxActiveLeads: 20,
};

export const ALLOWED_INTERVALS = [1, 2, 3, 5, 10] as const;

function mergeConfig(base: ProgressiveReleaseConfig, override: Partial<ProgressiveReleaseConfig> | null | undefined): ProgressiveReleaseConfig {
  if (!override || typeof override !== "object") return base;
  return {
    enabled: typeof override.enabled === "boolean" ? override.enabled : base.enabled,
    releaseIntervalMinutes: typeof override.releaseIntervalMinutes === "number" ? override.releaseIntervalMinutes : base.releaseIntervalMinutes,
    reservedBacklogPercent: typeof override.reservedBacklogPercent === "number" ? override.reservedBacklogPercent : base.reservedBacklogPercent,
    batchSizePerTier: { ...base.batchSizePerTier, ...(override.batchSizePerTier ?? {}) },
    maxActiveLeads: override.maxActiveLeads !== undefined ? override.maxActiveLeads : base.maxActiveLeads,
  };
}

const cacheKey = (companyId: string) => `progressive-config:${companyId}`;

// Cached with the same 30s TTL as the other assignment settings; the PATCH
// route invalidates on write so changes take effect immediately.
export async function getProgressiveConfig(companyId: string): Promise<ProgressiveReleaseConfig> {
  return cache.getOrSet(cacheKey(companyId), 30_000, async () => {
    const [row] = await db
      .select({ pc: automationSettings.progressiveConfig })
      .from(automationSettings)
      .where(eq(automationSettings.companyId, companyId))
      .limit(1);
    return mergeConfig(DEFAULT_PROGRESSIVE_CONFIG, row?.pc as Partial<ProgressiveReleaseConfig> | null);
  });
}

// Validate + persist a partial update. Throws on out-of-range values so the
// API returns a clear 400 instead of silently storing garbage the engine
// would then have to defend against every cycle.
export async function updateProgressiveConfig(companyId: string, patch: Partial<ProgressiveReleaseConfig>): Promise<ProgressiveReleaseConfig> {
  if (patch.releaseIntervalMinutes !== undefined && !ALLOWED_INTERVALS.includes(patch.releaseIntervalMinutes as (typeof ALLOWED_INTERVALS)[number])) {
    throw new Error(`Release interval must be one of: ${ALLOWED_INTERVALS.join(", ")} minutes.`);
  }
  if (patch.reservedBacklogPercent !== undefined && (!Number.isFinite(patch.reservedBacklogPercent) || patch.reservedBacklogPercent < 0 || patch.reservedBacklogPercent > 90)) {
    throw new Error("Reserved backlog must be between 0 and 90 percent.");
  }
  if (patch.maxActiveLeads !== undefined && patch.maxActiveLeads !== null && (!Number.isInteger(patch.maxActiveLeads) || patch.maxActiveLeads < 1 || patch.maxActiveLeads > 1000)) {
    throw new Error("Maximum active leads must be between 1 and 1000 (or empty for no cap).");
  }
  if (patch.batchSizePerTier !== undefined) {
    for (const [tier, size] of Object.entries(patch.batchSizePerTier)) {
      if (!(tierEnum.enumValues as readonly string[]).includes(tier)) throw new Error(`Unknown tier "${tier}".`);
      if (!Number.isInteger(size) || size < 1 || size > 50) throw new Error(`Batch size for tier ${tier} must be between 1 and 50.`);
    }
  }

  const [row] = await db
    .select({ pc: automationSettings.progressiveConfig })
    .from(automationSettings)
    .where(eq(automationSettings.companyId, companyId))
    .limit(1);
  const existing = (row?.pc as Partial<ProgressiveReleaseConfig> | null) ?? {};
  const next = {
    ...existing,
    ...patch,
    ...(patch.batchSizePerTier ? { batchSizePerTier: { ...(existing.batchSizePerTier ?? {}), ...patch.batchSizePerTier } } : {}),
  };
  await db.update(automationSettings).set({ progressiveConfig: next }).where(eq(automationSettings.companyId, companyId));
  await cache.delete(cacheKey(companyId));
  return mergeConfig(DEFAULT_PROGRESSIVE_CONFIG, next);
}
