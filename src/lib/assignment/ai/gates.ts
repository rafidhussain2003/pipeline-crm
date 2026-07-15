// Hard gates — applied BEFORE scoring to remove candidates that must never be
// picked (over capacity, paused/locked, off-schedule). Each returns a machine-
// readable reject reason (recorded for auditing/training) or null to keep.
import type { CandidateAgent } from "../types";
import type { AgentFeatures } from "./features";
import type { AIScoringConfig } from "./config";
import type { ActiveOverrides } from "./overrides";
import { isWithinSchedule } from "./agent-profile";

// Context shared by all gates (Phase 5): active overrides + the decision time.
export interface GateContext {
  overrides: ActiveOverrides;
  now: Date;
}

export interface Gate {
  readonly name: string;
  reject(agent: CandidateAgent, features: AgentFeatures, config: AIScoringConfig, ctx: GateContext): string | null;
}

// Capacity: never overload an agent. Prefers the agent's OWN configured limit
// (routing_config) over the company default, and honors a temporary
// capacity_boost override.
export const capacityGate: Gate = {
  name: "capacity",
  reject(agent, features, config, ctx) {
    const perAgentMaxActive = features.profile.capacity.maxActiveLeads;
    const boost = ctx.overrides.capacityBoost.get(agent.id) ?? 0;
    const maxActive = (perAgentMaxActive ?? config.capacity.maxActiveLeads) != null ? (perAgentMaxActive ?? config.capacity.maxActiveLeads)! + boost : null;
    if (maxActive != null && features.activeLeads >= maxActive) {
      return `over_capacity(active=${features.activeLeads}>=${maxActive})`;
    }
    const maxDaily = features.profile.capacity.maxDailyAssignments ?? config.capacity.maxDailyAssignments;
    if (maxDaily != null && features.todayCount >= maxDaily) {
      return `daily_cap(today=${features.todayCount}>=${maxDaily})`;
    }
    return null;
  },
};

// Pause/lock: a temporary manual (expiring) override, OR a config paused list.
export const pauseGate: Gate = {
  name: "pause",
  reject(agent, _features, config, ctx) {
    if (ctx.overrides.blocked.has(agent.id)) return "override:paused";
    return config.pausedAgentIds.includes(agent.id) ? "paused" : null;
  },
};

// Working schedule (Phase 5): never assign to an agent outside their schedule
// (working days/hours, lunch, timezone, vacation/holiday).
export const scheduleGate: Gate = {
  name: "schedule",
  reject(_agent, features, _config, ctx) {
    return isWithinSchedule(features.profile.schedule, ctx.now) ? null : "off_schedule";
  },
};

// ABSOLUTE gates must always be honored: an agent that is paused/locked or
// off-schedule is NEVER assigned — if that leaves nobody, the lead stays
// queued (respecting "never assign outside schedule / while paused").
export const ABSOLUTE_GATES: Gate[] = [pauseGate, scheduleGate];

// SOFT gates express a preference that may be overflowed: if EVERY remaining
// agent is over capacity, the engine assigns anyway (better to slightly
// overload than to strand a lead — "leads never stop").
export const SOFT_GATES: Gate[] = [capacityGate];

export function firstReject(
  gates: Gate[],
  agent: CandidateAgent,
  features: AgentFeatures,
  config: AIScoringConfig,
  ctx: GateContext
): string | null {
  for (const gate of gates) {
    const reason = gate.reject(agent, features, config, ctx);
    if (reason) return reason;
  }
  return null;
}
