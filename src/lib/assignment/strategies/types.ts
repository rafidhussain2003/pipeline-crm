import type { CandidateAgent, DecisionDetail } from "../types";

// Everything a strategy needs to pick one agent from an already-eligible
// pool. The pool is guaranteed non-empty and already filtered (blacklist,
// working hours, presence, skill, workload) by the pipeline BEFORE a
// strategy is asked — a strategy's only job is the final choice, so new
// strategies never re-implement eligibility.
export interface StrategyContext {
  // The concrete assignment mode being resolved (a single strategy class can
  // back several related modes, e.g. TierStrategy serves both `tier_based`
  // and `priority_based`; it branches on this).
  mode: string;
  candidates: CandidateAgent[];
  isHighPriority: boolean;
  weightByTier: Record<string, number>;
  workloadByAgent: Map<string, number>;
  // O(1) atomic round-robin position advance (UPDATE ... RETURNING inside the
  // per-company lock). Rotation strategies call it; direct strategies don't.
  advanceCursor: () => Promise<number>;
  // Company + lead being assigned. Added in Phase 3 so the AI strategy can
  // load per-company config + agent features; ignored by the simple
  // strategies (backward compatible).
  companyId: string;
  leadId: string;
  // Phase 5: the lead's skill requirements, resolved by the pipeline from the
  // lead row (skillRequirements jsonb, falling back to requiredSkillId). Only
  // the AI strategy reads it. Structural shape (no import) to avoid coupling.
  leadSkillRequirements?: { required: string[]; preferred: string[]; priority: string[] };
}

export interface StrategyDecision {
  agentId: string | null;
  // Short machine-ish explanation persisted to assignment_history for later
  // "why did lead X go to agent Y" analytics.
  rationale: string;
  // Phase 3 (AI): the chosen agent's composite score + full decision
  // breakdown. Optional — only the AI strategy sets them.
  score?: number;
  detail?: DecisionDetail;
}

// The abstraction every future assignment rule plugs into. A strategy is a
// pure decision function over an eligible pool — no DB access, no eligibility
// logic, no side effects — which is what makes them trivially unit-testable
// and swappable, and is the seam the AI phase replaces without touching the
// engine, the queue, events, history, or any caller.
export interface AssignmentStrategy {
  // Stable identifier, also the primary mode this strategy represents.
  readonly name: string;
  // The automation_settings.assignmentMode values this strategy handles.
  readonly modes: readonly string[];
  // Phase 1 status. Only TierStrategy is `active` — the formally shipped
  // reference strategy. The others are wired ONLY so existing companies'
  // configured modes keep working unchanged (backward compatibility is a
  // hard requirement); they are otherwise architecture-only until a later
  // phase formalizes them.
  readonly active: boolean;
  select(ctx: StrategyContext): Promise<StrategyDecision>;
}
