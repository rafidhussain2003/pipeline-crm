// AI scoring configuration — the single source of every tunable knob.
//
// "No hardcoded business logic": the scoring engine reads weights, thresholds,
// capacity rules and factor on/off switches from HERE, never from inline
// constants. Defaults live in code; a per-company override is stored as a
// jsonb blob on automation_settings.ai_config and merged over the defaults, so
// adding a new factor or knob never needs a migration or a schema change.
import { db } from "@/db";
import { automationSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";

// The factors the scoring engine currently ships. Adding a new one is: add its
// name here, register its module (ai/factors), give it a default weight below.
// Nothing else in the engine, pipeline, or callers changes.
export type FactorName = "availability" | "workload" | "idle" | "fairness" | "tier" | "performance" | "skill";

export interface FactorConfig {
  enabled: boolean;
  weight: number;
}

export interface AIScoringConfig {
  // Master switch. When false (or scoring throws), the AI strategy falls back
  // to the deterministic weighted strategy — leads never stop flowing.
  enabled: boolean;
  factors: Record<FactorName, FactorConfig>;
  capacity: {
    // Hard gate: an agent at/over this many OPEN active leads is skipped.
    maxActiveLeads: number | null;
    // Hard gate: an agent at/over this many assignments TODAY is skipped.
    maxDailyAssignments: number | null;
  };
  fairness: {
    // 0..1 — how strongly to equalize today's assignment counts.
    sensitivity: number;
  };
  idleBoost: {
    enabled: boolean;
    // Idle score reaches ~0.5 at this many seconds idle, asymptotes to 1.
    halfLifeSeconds: number;
  };
  performance: {
    // Global multiplier applied to the performance factor's weight.
    importance: number;
    // Below this many closed leads, blend the agent's close rate toward a
    // neutral 0.5 so a 1-win agent doesn't dominate on a tiny sample.
    minSampleForFullWeight: number;
  };
  // Temporary pause (no migration): these agent ids are skipped by the AI.
  pausedAgentIds: string[];
  // Manual override: if set and that agent is an eligible candidate, force it.
  manualOverrideAgentId: string | null;
}

export const DEFAULT_AI_CONFIG: AIScoringConfig = {
  enabled: true,
  factors: {
    availability: { enabled: true, weight: 1.0 },
    workload: { enabled: true, weight: 2.0 },
    idle: { enabled: true, weight: 1.5 },
    fairness: { enabled: true, weight: 2.0 },
    tier: { enabled: true, weight: 1.0 },
    performance: { enabled: true, weight: 1.5 },
    // Skill match (Phase 5) weighted heavily — the right skill matters more
    // than marginal load/fairness differences. Graded, never a hard filter.
    skill: { enabled: true, weight: 2.5 },
  },
  capacity: { maxActiveLeads: 50, maxDailyAssignments: null },
  fairness: { sensitivity: 1.0 },
  idleBoost: { enabled: true, halfLifeSeconds: 300 },
  performance: { importance: 1.0, minSampleForFullWeight: 10 },
  pausedAgentIds: [],
  manualOverrideAgentId: null,
};

// Deep-merge an override (any subset) over the defaults. Factors merge per
// factor so an override can tweak one factor's weight without restating them
// all.
function mergeConfig(base: AIScoringConfig, override: Partial<AIScoringConfig> | null | undefined): AIScoringConfig {
  if (!override || typeof override !== "object") return base;
  const factors = { ...base.factors };
  if (override.factors) {
    for (const key of Object.keys(override.factors) as FactorName[]) {
      const o = override.factors[key];
      if (o) factors[key] = { ...factors[key], ...o };
    }
  }
  return {
    enabled: override.enabled ?? base.enabled,
    factors,
    capacity: { ...base.capacity, ...(override.capacity ?? {}) },
    fairness: { ...base.fairness, ...(override.fairness ?? {}) },
    idleBoost: { ...base.idleBoost, ...(override.idleBoost ?? {}) },
    performance: { ...base.performance, ...(override.performance ?? {}) },
    pausedAgentIds: override.pausedAgentIds ?? base.pausedAgentIds,
    manualOverrideAgentId: override.manualOverrideAgentId ?? base.manualOverrideAgentId,
  };
}

const cacheKey = (companyId: string) => `ai-config:${companyId}`;

// Per-company config, cached (30s TTL, same as the assignment settings cache).
// A cache hit is the common case — so reading config in the hot assignment
// path costs nothing after the first lead.
export async function getAIConfig(companyId: string): Promise<AIScoringConfig> {
  return cache.getOrSet(cacheKey(companyId), 30_000, async () => {
    const [row] = await db
      .select({ ai: automationSettings.aiConfig })
      .from(automationSettings)
      .where(eq(automationSettings.companyId, companyId))
      .limit(1);
    return mergeConfig(DEFAULT_AI_CONFIG, row?.ai as Partial<AIScoringConfig> | null);
  });
}

// Update a company's AI config (merges over any existing override). For a
// future admin API / tests — there is no UI in this phase. Invalidates the
// cache so the change takes effect immediately.
export async function updateAIConfig(companyId: string, patch: Partial<AIScoringConfig>): Promise<void> {
  const [row] = await db
    .select({ ai: automationSettings.aiConfig })
    .from(automationSettings)
    .where(eq(automationSettings.companyId, companyId))
    .limit(1);
  const existing = (row?.ai as Partial<AIScoringConfig> | null) ?? {};
  const next = { ...existing, ...patch };
  await db.update(automationSettings).set({ aiConfig: next }).where(eq(automationSettings.companyId, companyId));
  await cache.delete(cacheKey(companyId));
}
