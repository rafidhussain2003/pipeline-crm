import type { PredictiveModel } from "./model";
import { scoreLead } from "../lead-scoring";

export type WinProbabilityInput = { leadId: string };
export type WinProbabilityOutput = { leadId: string; winProbabilityPct: number; basis: string } | null;

// Heuristic: reuses the lead score (Part 2) directly as a probability
// proxy — a 0-100 score becomes a 0-100% probability. This is intentionally
// the simplest possible model that's still grounded in real signals, not a
// trained classifier. It's registered behind the same PredictiveModel
// interface a real model would use, so replacing it later doesn't touch
// any caller.
class HeuristicWinProbabilityModel implements PredictiveModel<WinProbabilityInput, WinProbabilityOutput> {
  readonly name = "heuristic-win-probability-v1";

  async predict(input: WinProbabilityInput): Promise<WinProbabilityOutput> {
    const score = await scoreLead(input.leadId);
    if (!score) return null;
    return {
      leadId: input.leadId,
      winProbabilityPct: score.score,
      basis: `Derived from lead score (${score.score}/100) — a heuristic, not a trained model. See src/lib/ai/lead-scoring.ts for the factor breakdown.`,
    };
  }
}

export const winProbabilityModel: PredictiveModel<WinProbabilityInput, WinProbabilityOutput> = new HeuristicWinProbabilityModel();
