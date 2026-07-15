// The modular scoring factors.
//
// Each factor is a pure, synchronous function that scores ONE agent in [0,1]
// (or returns null to abstain). No I/O — all data it needs is precomputed and
// passed in — so scoring the whole pool is microseconds. Factors are
// independently enable/disable-able and weightable via config, and adding a
// new one is: append an object here + register it in ALL_FACTORS + give it a
// default weight in config.ts. Nothing else in the engine changes.
import type { CandidateAgent } from "../types";
import type { AgentFeatures } from "./features";
import type { AIScoringConfig, FactorName } from "./config";
import { gradeSkillMatch, type LeadSkillRequirements } from "./skills";

// Pool-level aggregates the engine computes ONCE and shares, so factors that
// normalize against the pool (workload, fairness, tier) stay O(1).
export interface PoolStats {
  maxActiveLeads: number;
  maxTodayCount: number;
  maxTierWeight: number;
  weightByTier: Record<string, number>;
  now: number;
  leadSkillRequirements: LeadSkillRequirements;
}

export interface FactorContext {
  agent: CandidateAgent;
  features: AgentFeatures;
  config: AIScoringConfig;
  pool: PoolStats;
  isHighPriority: boolean;
}

export interface ScoringFactor {
  readonly name: FactorName;
  score(ctx: FactorContext): number | null;
}

const tierOf = (a: CandidateAgent) => a.tier || "1";

// ONLINE preferred over BUSY. Both are eligible (the pool is already presence-
// filtered), but a plain-online agent is a marginally better target than one
// marked busy/wrap_up.
export const availabilityFactor: ScoringFactor = {
  name: "availability",
  score({ agent }) {
    const s = agent.presenceStatus;
    if (s === "online" || s === "idle") return 1.0;
    if (s === "busy" || s === "wrap_up") return 0.7;
    return 0.5;
  },
};

// Fewer open active leads = higher, relative to the busiest agent in the pool
// (so it's about balance, not an absolute number).
export const workloadFactor: ScoringFactor = {
  name: "workload",
  score({ features, pool }) {
    if (pool.maxActiveLeads <= 0) return 1.0;
    return 1 - features.activeLeads / pool.maxActiveLeads;
  },
};

// Idle boost: the longer an agent has waited since their last assignment, the
// higher they score — so a waiting agent gradually rises and can never be
// permanently starved. Smooth curve: 0 at idle=0, ~0.5 at one half-life, → 1.
// An agent who has NEVER been assigned is treated as maximally idle.
export const idleFactor: ScoringFactor = {
  name: "idle",
  score({ agent, config, pool }) {
    if (!config.idleBoost.enabled) return null;
    if (agent.lastAssignedAt === null) return 1.0;
    const idleMs = pool.now - agent.lastAssignedAt.getTime();
    const halfLifeMs = Math.max(1_000, config.idleBoost.halfLifeSeconds * 1_000);
    return 1 - Math.pow(2, -idleMs / halfLifeMs);
  },
};

// Fairness: equalize TODAY's assignment counts. An agent with fewer than the
// busiest-today scores higher; sensitivity in [0,1] scales how sharply (0 =
// fairness off/neutral, 1 = full spread). This is what stops one agent
// receiving every lead across a day.
export const fairnessFactor: ScoringFactor = {
  name: "fairness",
  score({ features, pool, config }) {
    if (pool.maxTodayCount <= 0) return 1.0;
    const base = 1 - features.todayCount / pool.maxTodayCount;
    const s = Math.max(0, Math.min(1, config.fairness.sensitivity));
    return (1 - s) * 0.5 + s * base;
  },
};

// Tier priority, normalized against the highest-weight tier present.
export const tierFactor: ScoringFactor = {
  name: "tier",
  score({ agent, pool }) {
    const w = pool.weightByTier[tierOf(agent)] ?? 1;
    return pool.maxTierWeight > 0 ? w / pool.maxTierWeight : 1;
  },
};

// Performance: historical close rate, Bayesian-smoothed toward a neutral 0.5
// until the agent has enough closed leads, so a 1-win agent can't dominate on
// a tiny sample. (config.performance.importance scales its WEIGHT, applied by
// the engine, not the score.)
export const performanceFactor: ScoringFactor = {
  name: "performance",
  score({ features, config }) {
    const priorWeight = Math.max(1, config.performance.minSampleForFullWeight);
    const smoothed = (features.wonCount + 0.5 * priorWeight) / (features.totalCount + priorWeight);
    return Math.max(0, Math.min(1, smoothed));
  },
};

// Skill match (Phase 5): grade the agent against the lead's skill requirements
// (perfect > preferred > partial > fallback). Graded score, never a gate — a
// no-skill agent still scores (low), so lead flow never stops.
export const skillFactor: ScoringFactor = {
  name: "skill",
  score({ features, pool }) {
    return gradeSkillMatch(features.skills, pool.leadSkillRequirements).score;
  },
};

export const ALL_FACTORS: Record<FactorName, ScoringFactor> = {
  availability: availabilityFactor,
  workload: workloadFactor,
  idle: idleFactor,
  fairness: fairnessFactor,
  tier: tierFactor,
  performance: performanceFactor,
  skill: skillFactor,
};
