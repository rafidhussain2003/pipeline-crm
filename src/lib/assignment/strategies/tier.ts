import type { AssignmentStrategy, StrategyContext, StrategyDecision } from "./types";
import { rotateTopTier, rotateWeighted, tierOf } from "./util";

// The Phase 1 ACTIVE reference strategy.
//
// tier_based:     always the highest tier that has an available agent; rotate
//                 equally within that tier.
// priority_based: high-priority leads go to the best available tier (tier
//                 rotation); normal-priority leads fall back to weighted
//                 rotation — so this one strategy backs both modes and
//                 branches on ctx.mode + ctx.isHighPriority.
export class TierStrategy implements AssignmentStrategy {
  readonly name = "tier_based";
  readonly modes = ["tier_based", "priority_based"] as const;
  readonly active = true;

  async select(ctx: StrategyContext): Promise<StrategyDecision> {
    const { candidates, mode, isHighPriority, weightByTier, advanceCursor } = ctx;
    if (candidates.length === 1) return { agentId: candidates[0].id, rationale: "sole-candidate" };

    // priority_based only diverts HIGH leads to the top tier; normal leads
    // use the standard weighted rotation (exactly the original behavior).
    if (mode === "priority_based" && !isHighPriority) {
      const agentId = await rotateWeighted(candidates, (a) => weightByTier[tierOf(a)] ?? 1, advanceCursor);
      return { agentId, rationale: "priority_based:normal->weighted" };
    }

    const agentId = await rotateTopTier(candidates, advanceCursor);
    return { agentId, rationale: `${mode}:top-tier-rotation` };
  }
}
