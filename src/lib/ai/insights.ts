// AI analytics / insights (Part 7) — deterministic comparison and
// threshold-based anomaly detection over the existing analytics service
// (Phase 4), not an LLM call. "Insight" here means "a plain-language
// statement about a real, computed change," not a generated narrative —
// the actual prose explanation of *why* (Part 4's "analytics explanations")
// would go through the AI provider once one is configured; this produces
// the structured facts that explanation would be grounded in.
import { getConversionFunnel, getLeadSummary } from "../analytics/service";
import { calculateGrowthRate } from "../analytics/kpis";
import type { DateRange } from "../analytics/types";

export type Insight = {
  type: "growth" | "decline" | "anomaly";
  metric: string;
  message: string;
  changePct: number;
};

function shiftRangeBack(range: DateRange): DateRange {
  const durationMs = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - durationMs), to: range.from };
}

const SIGNIFICANT_CHANGE_PCT = 20; // below this, a change is treated as normal noise, not an insight
const ANOMALY_CHANGE_PCT = 50; // beyond this, it's flagged as an anomaly rather than an ordinary trend

export async function generateLeadVolumeInsight(companyId: string, range: DateRange): Promise<Insight | null> {
  const previousRange = shiftRangeBack(range);
  const [current, previous] = await Promise.all([getLeadSummary(companyId, range), getLeadSummary(companyId, previousRange)]);

  const changePct = calculateGrowthRate(previous.total, current.total);
  if (Math.abs(changePct) < SIGNIFICANT_CHANGE_PCT) return null;

  const isAnomaly = Math.abs(changePct) >= ANOMALY_CHANGE_PCT;
  return {
    type: isAnomaly ? "anomaly" : changePct > 0 ? "growth" : "decline",
    metric: "lead_volume",
    message: `Lead volume ${changePct > 0 ? "increased" : "decreased"} ${Math.abs(changePct)}% compared to the previous equivalent period (${previous.total} -> ${current.total} leads).`,
    changePct,
  };
}

export async function generateConversionInsight(companyId: string, range: DateRange): Promise<Insight | null> {
  const previousRange = shiftRangeBack(range);
  const [current, previous] = await Promise.all([getConversionFunnel(companyId, range), getConversionFunnel(companyId, previousRange)]);

  const changePct = calculateGrowthRate(previous.conversionRatePct, current.conversionRatePct);
  if (Math.abs(changePct) < SIGNIFICANT_CHANGE_PCT || previous.totalCount === 0) return null;

  const isAnomaly = Math.abs(changePct) >= ANOMALY_CHANGE_PCT;
  return {
    type: isAnomaly ? "anomaly" : changePct > 0 ? "growth" : "decline",
    metric: "conversion_rate",
    message: `Conversion rate ${changePct > 0 ? "improved" : "dropped"} ${Math.abs(changePct)}% compared to the previous period (${previous.conversionRatePct}% -> ${current.conversionRatePct}%).`,
    changePct,
  };
}

export async function generateInsights(companyId: string, range: DateRange): Promise<Insight[]> {
  const [volumeInsight, conversionInsight] = await Promise.all([
    generateLeadVolumeInsight(companyId, range),
    generateConversionInsight(companyId, range),
  ]);
  return [volumeInsight, conversionInsight].filter((i): i is Insight => i !== null);
}
