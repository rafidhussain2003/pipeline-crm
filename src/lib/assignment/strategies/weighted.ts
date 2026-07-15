import type { AssignmentStrategy, StrategyContext, StrategyDecision } from "./types";
import { rotateWeighted, tierOf } from "./util";

// weighted:     rotation weighted by tier (Tier 1 gets more than Tier 3 by
//               default; the exact weights come from assignment_rules).
// skill_based:  identical distribution — the pool is already restricted to
//               agents with the lead's required skill by the pipeline, so the
//               choice among them is just the standard weighted rotation.
//
// Architecture-only for Phase 1; wired for backward compatibility.
export class WeightedStrategy implements AssignmentStrategy {
  readonly name = "weighted";
  readonly modes = ["weighted", "skill_based"] as const;
  readonly active = false;

  async select(ctx: StrategyContext): Promise<StrategyDecision> {
    const { candidates, mode, weightByTier, advanceCursor } = ctx;
    if (candidates.length === 1) return { agentId: candidates[0].id, rationale: "sole-candidate" };

    const agentId = await rotateWeighted(candidates, (a) => weightByTier[tierOf(a)] ?? 1, advanceCursor);
    return { agentId, rationale: `${mode}:weighted-by-tier` };
  }
}
