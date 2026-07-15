// The scoring engine — turns an eligible candidate pool + their features +
// config into a ranked decision. Pure and synchronous (all I/O happened in the
// feature provider), so it runs in microseconds even for a large pool.
//
// Order: reserve/manual override -> hard gates (pause/lock, schedule, capacity)
// -> weighted multi-factor score (incl. Phase 5 skill match) -> rank. Returns
// the full breakdown (chosen + every scored candidate's per-factor scores +
// every rejected candidate's reason) as explainability + training data.
import type { CandidateAgent } from "../types";
import type { AgentFeatures } from "./features";
import type { AIScoringConfig, FactorName } from "./config";
import type { ActiveOverrides } from "./overrides";
import type { LeadSkillRequirements } from "./skills";
import { ALL_FACTORS, type PoolStats } from "./factors";
import { ABSOLUTE_GATES, SOFT_GATES, firstReject } from "./gates";
import { DEFAULT_AGENT_PROFILE } from "./agent-profile";
import { metrics } from "@/lib/infra/metrics";

export interface FactorScoreDetail {
  factor: string;
  score: number;
  weight: number;
  weighted: number;
}
export interface ScoredCandidate {
  agentId: string;
  score: number;
  factors: FactorScoreDetail[];
}
export interface RejectedCandidate {
  agentId: string;
  reason: string;
}
export interface ScoringResult {
  chosen: ScoredCandidate | null;
  scored: ScoredCandidate[]; // ranked desc
  rejected: RejectedCandidate[];
  overrideApplied: boolean;
}

const EMPTY_FEATURES: AgentFeatures = {
  activeLeads: 0,
  todayCount: 0,
  wonCount: 0,
  totalCount: 0,
  closeRate: 0,
  skills: new Set(),
  profile: DEFAULT_AGENT_PROFILE,
};
const round = (x: number) => Math.round(x * 1000) / 1000;

export interface ScoringOptions {
  weightByTier: Record<string, number>;
  isHighPriority: boolean;
  leadRequirements: LeadSkillRequirements;
  overrides: ActiveOverrides;
  now?: Date;
}

export function runScoringEngine(
  candidates: CandidateAgent[],
  features: Map<string, AgentFeatures>,
  config: AIScoringConfig,
  opts: ScoringOptions
): ScoringResult {
  const now = opts.now ?? new Date();
  const feat = (id: string) => features.get(id) ?? EMPTY_FEATURES;
  const gateCtx = { overrides: opts.overrides, now };

  // Reserve/force (Phase 5 expiring override) or config manual override: pin to
  // a specific agent if they're an eligible candidate. Intentional — bypasses
  // the soft score (still must be in the presence-filtered pool).
  const forcedId = opts.overrides.reservedAgentId ?? config.manualOverrideAgentId;
  if (forcedId) {
    const forced = candidates.find((a) => a.id === forcedId);
    if (forced) {
      const chosen: ScoredCandidate = { agentId: forced.id, score: 1, factors: [{ factor: "override", score: 1, weight: 1, weighted: 1 }] };
      return { chosen, scored: [chosen], rejected: [], overrideApplied: true };
    }
  }

  const rejected: RejectedCandidate[] = [];

  // ABSOLUTE gates (pause/lock, schedule) — an agent failing these is NEVER
  // chosen. If that leaves nobody, the lead stays queued (chosen=null); the
  // strategy does NOT overflow past pause/schedule.
  const absoluteSurvivors: CandidateAgent[] = [];
  for (const a of candidates) {
    const reason = firstReject(ABSOLUTE_GATES, a, feat(a.id), config, gateCtx);
    if (reason) {
      rejected.push({ agentId: a.id, reason });
      if (reason.startsWith("off_schedule")) metrics.increment("assignment.schedule_skipped");
    } else {
      absoluteSurvivors.push(a);
    }
  }
  if (absoluteSurvivors.length === 0) return { chosen: null, scored: [], rejected, overrideApplied: false };

  // SOFT gate (capacity) — prefer agents under capacity; if EVERY absolute-
  // survivor is over capacity, overflow (use them all) so a lead is never
  // stranded just because everyone is busy.
  const underCap: CandidateAgent[] = [];
  const overCap: RejectedCandidate[] = [];
  for (const a of absoluteSurvivors) {
    const reason = firstReject(SOFT_GATES, a, feat(a.id), config, gateCtx);
    if (reason) overCap.push({ agentId: a.id, reason });
    else underCap.push(a);
  }
  const survivors = underCap.length > 0 ? underCap : absoluteSurvivors;
  // When we actually excluded over-cap agents, record them as rejected; on
  // overflow they remain scorable (not rejected).
  if (underCap.length > 0) rejected.push(...overCap);

  // Pool stats for normalization (computed once).
  let maxActiveLeads = 0;
  let maxTodayCount = 0;
  let maxTierWeight = 0;
  for (const a of survivors) {
    const f = feat(a.id);
    if (f.activeLeads > maxActiveLeads) maxActiveLeads = f.activeLeads;
    if (f.todayCount > maxTodayCount) maxTodayCount = f.todayCount;
    const w = opts.weightByTier[a.tier || "1"] ?? 1;
    if (w > maxTierWeight) maxTierWeight = w;
  }
  const pool: PoolStats = {
    maxActiveLeads,
    maxTodayCount,
    maxTierWeight,
    weightByTier: opts.weightByTier,
    now: now.getTime(),
    leadSkillRequirements: opts.leadRequirements,
  };

  const enabledFactors = (Object.keys(config.factors) as FactorName[]).filter((n) => config.factors[n].enabled && ALL_FACTORS[n]);

  const scored: ScoredCandidate[] = survivors.map((agent) => {
    const f = feat(agent.id);
    const factors: FactorScoreDetail[] = [];
    let weightedSum = 0;
    let weightSum = 0;
    for (const name of enabledFactors) {
      const s = ALL_FACTORS[name].score({ agent, features: f, config, pool, isHighPriority: opts.isHighPriority });
      if (s === null) continue;
      const weight = config.factors[name].weight * (name === "performance" ? config.performance.importance : 1);
      const weighted = s * weight;
      factors.push({ factor: name, score: round(s), weight: round(weight), weighted: round(weighted) });
      weightedSum += weighted;
      weightSum += weight;
    }
    const score = weightSum > 0 ? weightedSum / weightSum : 0;
    return { agentId: agent.id, score: round(score), factors };
  });

  scored.sort((x, y) => y.score - x.score || x.agentId.localeCompare(y.agentId));

  // Track skill-fallback: the winner had no real skill match despite the lead
  // having requirements (routing had to fall back). Feeds the fallback-rate metric.
  const chosen = scored[0];
  const chosenSkill = chosen.factors.find((f) => f.factor === "skill");
  const hasReq = opts.leadRequirements.required.length + opts.leadRequirements.preferred.length + opts.leadRequirements.priority.length > 0;
  if (hasReq && chosenSkill && chosenSkill.score <= 0.15) metrics.increment("assignment.skill_fallback");

  return { chosen, scored, rejected, overrideApplied: false };
}
