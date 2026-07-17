// Phase 15 — AI prioritization for callbacks. When many callbacks come due at
// once, this decides what the agent should call FIRST. Deterministic and
// explainable — the same approach as the existing AI assignment/insights
// engines (no external model): a weighted sum of the signals the spec names.
//
//   scheduled time     — how overdue it already is (the dominant signal)
//   lead priority      — the callback's own priority (urgent/high/normal/low)
//   lead value         — the lead's AI insight score (0-100), when available
//   waiting duration   — how long the lead has been in the pipeline
//   customer status    — returning customer boosts; closed/lost sinks
import { WON_DISPOSITION } from "@/lib/analytics/kpis";
import type { CallbackPriority } from "./types";

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 40, high: 25, normal: 10, low: 0 };
const NEGATIVE_TERMINAL = new Set(["Not Interested", "Lost"]);

export interface PrioritySignals {
  scheduledAt: Date;
  priority: CallbackPriority | string;
  leadScore?: number | null; // lead_insights.score (0-100) = "lead value"
  leadCreatedAt?: Date | null; // waiting duration
  disposition?: string | null; // customer status
  isDuplicate?: boolean | null; // returning customer
  now?: Date;
}

// Higher = call this one first.
export function computePriorityScore(s: PrioritySignals): number {
  const now = (s.now ?? new Date()).getTime();
  let score = 0;

  // 1. Scheduled time — minutes overdue dominate (capped so an ancient
  // callback can't drown out a genuinely urgent fresh one).
  const overdueMin = (now - s.scheduledAt.getTime()) / 60_000;
  score += Math.max(0, Math.min(120, overdueMin)) * 0.5; // 0..60
  // Not yet due → slightly negative so due ones always sort first.
  if (overdueMin < 0) score += Math.max(-20, overdueMin * 0.05);

  // 2. Callback priority.
  score += PRIORITY_WEIGHT[String(s.priority)] ?? 10;

  // 3. Lead value (AI insight score).
  if (typeof s.leadScore === "number") score += (Math.max(0, Math.min(100, s.leadScore)) / 100) * 20;

  // 4. Waiting duration — hours since the lead arrived, capped.
  if (s.leadCreatedAt) {
    const hours = (now - s.leadCreatedAt.getTime()) / 3_600_000;
    score += Math.max(0, Math.min(10, hours / 24 * 10)); // 0..10 over ~24h+
  }

  // 5. Customer status.
  if (s.isDuplicate) score += 8; // returning customer
  if (s.disposition === WON_DISPOSITION) score -= 15; // already won
  if (s.disposition && NEGATIVE_TERMINAL.has(s.disposition)) score -= 20;

  return Math.round(score * 100) / 100;
}
