import type { AssignmentStrategy, StrategyContext, StrategyDecision } from "./types";

// The `random` baseline strategy (uniformly random eligible agent) — the
// trivial control the real AI is measured against.
//
// NOTE: mode "ai" used to be a deterministic heuristic here; as of Phase 3 it
// is owned by the full modular scoring engine in src/lib/assignment/ai/
// (aiAssignmentStrategy). This class now only serves "random".
export class AIBasedStrategy implements AssignmentStrategy {
  readonly name = "random";
  readonly modes = ["random"] as const;
  readonly active = false;

  async select(ctx: StrategyContext): Promise<StrategyDecision> {
    const { candidates } = ctx;
    if (candidates.length === 1) return { agentId: candidates[0].id, rationale: "sole-candidate" };
    const agentId = candidates[Math.floor(Math.random() * candidates.length)].id;
    return { agentId, rationale: "random:uniform" };
  }
}
