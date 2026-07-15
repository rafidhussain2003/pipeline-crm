// Strategy registry — the single place that turns a company's configured
// assignment mode into the strategy object the pipeline executes. Adding a
// future strategy is: write the class, add it to this array. Nothing else in
// the engine changes.
import type { AssignmentStrategy } from "./types";
import { TierStrategy } from "./tier";
import { RoundRobinStrategy } from "./round-robin";
import { WeightedStrategy } from "./weighted";
import { BalancedStrategy } from "./balanced";
import { AIBasedStrategy } from "./ai";
import { aiAssignmentStrategy } from "../ai/strategy";

export type { AssignmentStrategy, StrategyContext, StrategyDecision } from "./types";

// TierStrategy first: it is the default/fallback for any unrecognized mode.
// The Phase 3 AI strategy (aiAssignmentStrategy) owns mode "ai"; AIBasedStrategy
// is now only the "random" baseline (see ./ai.ts).
const STRATEGIES: AssignmentStrategy[] = [
  new TierStrategy(),
  new RoundRobinStrategy(),
  new WeightedStrategy(),
  new BalancedStrategy(),
  new AIBasedStrategy(),
  aiAssignmentStrategy,
];

const BY_MODE = new Map<string, AssignmentStrategy>();
for (const strategy of STRATEGIES) {
  for (const mode of strategy.modes) BY_MODE.set(mode, strategy);
}

// The canonical/default strategy (Phase 1: Tier). Used when a company has no
// mode set or an unknown one — never leaves a lead un-routable.
export const DEFAULT_STRATEGY: AssignmentStrategy = STRATEGIES[0];

export function resolveStrategy(mode: string | null | undefined): AssignmentStrategy {
  if (!mode) return DEFAULT_STRATEGY;
  return BY_MODE.get(mode) ?? DEFAULT_STRATEGY;
}

// Introspection for the metrics/report surface (which strategies exist, which
// are active) — no behavior, just visibility.
export function listStrategies(): { name: string; modes: readonly string[]; active: boolean }[] {
  return STRATEGIES.map((s) => ({ name: s.name, modes: s.modes, active: s.active }));
}
