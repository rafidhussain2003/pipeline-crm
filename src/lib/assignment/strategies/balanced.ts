import type { AssignmentStrategy, StrategyContext, StrategyDecision } from "./types";
import { idleMs } from "./util";

// The load-balancing family.
//
// least_active:   the agent with the fewest currently-open (non-terminal)
//                 leads; ties broken by longest idle.
// most_available: the agent who has been idle longest (waiting most for a
//                 lead); ties broken by id for determinism.
//
// Architecture-only for Phase 1; wired for backward compatibility. Both rely
// on workloadByAgent, which the pipeline computes once and passes in.
export class BalancedStrategy implements AssignmentStrategy {
  readonly name = "balanced";
  readonly modes = ["least_active", "most_available"] as const;
  readonly active = false;

  async select(ctx: StrategyContext): Promise<StrategyDecision> {
    const { candidates, mode, workloadByAgent } = ctx;
    if (candidates.length === 1) return { agentId: candidates[0].id, rationale: "sole-candidate" };

    if (mode === "least_active") {
      const agentId = [...candidates].sort(
        (a, b) => (workloadByAgent.get(a.id) || 0) - (workloadByAgent.get(b.id) || 0) || idleMs(b) - idleMs(a)
      )[0].id;
      return { agentId, rationale: "least_active:fewest-open-leads" };
    }

    // most_available
    const agentId = [...candidates].sort((a, b) => idleMs(b) - idleMs(a) || a.id.localeCompare(b.id))[0].id;
    return { agentId, rationale: "most_available:longest-idle" };
  }
}
