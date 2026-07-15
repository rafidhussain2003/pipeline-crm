// The AI assignment strategy — the enterprise routing brain, plugged into the
// Phase 1 strategy seam so the engine stays the single owner of assignment.
// Active for companies whose automation_settings.assignmentMode === "ai".
//
// FAILURE SAFETY: any UNEXPECTED failure (config load, feature load, scoring
// bug, disabled config) falls back to deterministic weighted rotation and
// records why — the engine can never stop placing leads because of the AI.
// BUT a legitimate "nobody is eligible right now" (everyone paused/off-schedule
// — the absolute gates) is NOT an error: the lead is left queued (agentId null)
// to be retried/escalated later, honoring "never assign outside schedule".
import type { AssignmentStrategy, StrategyContext, StrategyDecision } from "../strategies/types";
import type { DecisionDetail } from "../types";
import { rotateWeighted, tierOf } from "../strategies/util";
import { getAIConfig } from "./config";
import { getAgentFeatures } from "./features";
import { getActiveOverrides } from "./overrides";
import { runScoringEngine } from "./scoring-engine";
import type { LeadSkillRequirements } from "./skills";

const NO_REQUIREMENTS: LeadSkillRequirements = { required: [], preferred: [], priority: [] };

export class AIAssignmentStrategy implements AssignmentStrategy {
  readonly name = "ai";
  readonly modes = ["ai"] as const;
  readonly active = true;

  async select(ctx: StrategyContext): Promise<StrategyDecision> {
    const started = Date.now();
    try {
      const config = await getAIConfig(ctx.companyId);
      if (!config.enabled) return this.fallback(ctx, started, "ai_disabled");

      // All caches warmed before the lock (see warmAIContext) → hits here.
      const [features, overrides] = await Promise.all([
        getAgentFeatures(ctx.companyId, ctx.candidates.map((a) => a.id), ctx.workloadByAgent),
        getActiveOverrides(ctx.companyId),
      ]);
      const leadRequirements = (ctx.leadSkillRequirements as LeadSkillRequirements | undefined) ?? NO_REQUIREMENTS;

      const result = runScoringEngine(ctx.candidates, features, config, {
        weightByTier: ctx.weightByTier,
        isHighPriority: ctx.isHighPriority,
        leadRequirements,
        overrides,
      });

      if (!result.chosen) {
        // Everyone was absolute-gated (paused / off-schedule). This is a real
        // "no eligible agent" — leave it queued, do NOT overflow past schedule.
        return {
          agentId: null,
          rationale: "ai:no_eligible_after_gates",
          detail: buildDetail("ai:no_eligible_after_gates", true, null, result.scored, result.rejected, false, started),
        };
      }

      const top = result.chosen;
      const topReasons = [...top.factors].sort((a, b) => b.weighted - a.weighted).slice(0, 3).map((f) => `${f.factor}=${f.score}`);
      const strategyLabel = result.overrideApplied ? "ai:override" : "ai";
      return {
        agentId: top.agentId,
        rationale: `${strategyLabel}:score=${top.score}`,
        score: top.score,
        detail: buildDetail(strategyLabel, true, { agentId: top.agentId, score: top.score, topReasons }, result.scored, result.rejected, result.overrideApplied, started),
      };
    } catch (err) {
      return this.fallback(ctx, started, `error:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Deterministic weighted rotation — the guaranteed-working path, used ONLY on
  // config-disabled or an unexpected error (never to bypass pause/schedule).
  private async fallback(ctx: StrategyContext, started: number, reason: string): Promise<StrategyDecision> {
    const agentId = await rotateWeighted(ctx.candidates, (a) => ctx.weightByTier[tierOf(a)] ?? 1, ctx.advanceCursor);
    return {
      agentId,
      rationale: `ai_fallback:${reason}`,
      detail: buildDetail(`ai:fallback:${reason}`, false, agentId ? { agentId, score: 0, topReasons: [`fallback:${reason}`] } : null, [], [], false, started),
    };
  }
}

function buildDetail(
  strategy: string,
  aiEnabled: boolean,
  chosen: DecisionDetail["chosen"],
  scored: DecisionDetail["scored"],
  rejected: DecisionDetail["rejected"],
  overrideApplied: boolean,
  started: number
): DecisionDetail {
  return { strategy, aiEnabled, chosen, scored, rejected, overrideApplied, durationMs: Date.now() - started };
}

// Warms the per-company AI caches (config + agent features incl. skills &
// profiles + active overrides) BEFORE the assignment lock, so scoring inside
// the lock does zero DB work. Cheap, idempotent, safe to call every assignment.
export async function warmAIContext(companyId: string, agentIds: string[], workloadByAgent: Map<string, number>): Promise<void> {
  await Promise.all([getAIConfig(companyId), getAgentFeatures(companyId, agentIds, workloadByAgent), getActiveOverrides(companyId)]);
}

export const aiAssignmentStrategy = new AIAssignmentStrategy();
