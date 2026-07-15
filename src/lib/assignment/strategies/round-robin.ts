import type { AssignmentStrategy, StrategyContext, StrategyDecision } from "./types";
import { rotateWeighted } from "./util";

// round_robin:   equal, cursor-based rotation across the whole eligible pool.
// last_assigned: sticky — the agent assigned most recently keeps the affinity
//                while still eligible (burst affinity with one rep); falls
//                back to round-robin the first time (nobody has a prior).
//
// Architecture-only for Phase 1 (only TierStrategy is `active`); wired so
// companies already configured on these modes keep working unchanged.
export class RoundRobinStrategy implements AssignmentStrategy {
  readonly name = "round_robin";
  readonly modes = ["round_robin", "last_assigned"] as const;
  readonly active = false;

  async select(ctx: StrategyContext): Promise<StrategyDecision> {
    const { candidates, mode, advanceCursor } = ctx;
    if (candidates.length === 1) return { agentId: candidates[0].id, rationale: "sole-candidate" };

    if (mode === "last_assigned") {
      const withPrior = candidates.filter((a) => a.lastAssignedAt !== null);
      if (withPrior.length > 0) {
        const agentId = withPrior.sort((a, b) => b.lastAssignedAt!.getTime() - a.lastAssignedAt!.getTime())[0].id;
        return { agentId, rationale: "last_assigned:sticky" };
      }
      // no prior assignment in pool -> behave as round-robin
    }

    const agentId = await rotateWeighted(candidates, () => 1, advanceCursor);
    return { agentId, rationale: "round_robin:equal-rotation" };
  }
}
