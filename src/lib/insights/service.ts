// Phase 9 — Lead Insights service. Orchestrates the EXISTING deterministic
// engine (src/lib/ai scoreLead + recommendNextAction) plus this phase's
// classification layer into one persisted insight, and reads it back for the
// Lead Details card. The lead_insights row is a cache: getLeadInsights
// recomputes transparently whenever the lead has changed since the row was
// written, so the card is always current ("continuously recalculated") while a
// repeat view is O(1). All work here is off the assignment path.
import { db } from "@/db";
import { leadInsights, leads } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { scoreLead, type ScoreFactor } from "@/lib/ai/lead-scoring";
import { recommendNextAction } from "@/lib/ai/next-best-action";
import { createLogger } from "@/lib/logger";
import { gatherInsightSignals, sourceLabel, type InsightSignals } from "./signals";
import {
  temperatureOf,
  scoreLabelOf,
  tagsOf,
  deriveRecommendation,
  deriveFollowUp,
  composeSummary,
  composeExplanation,
  type Temperature,
  type InsightAction,
} from "./classify";

const logger = createLogger({ component: "lead-insights" });
export const INSIGHTS_ENGINE_VERSION = 1;

export type ComposedInsight = {
  leadId: string;
  companyId: string;
  score: number;
  scoreLabel: string;
  temperature: Temperature;
  tags: string[];
  summary: string;
  recommendation: InsightAction;
  recommendationLabel: string;
  recommendationReason: string;
  followUpAt: Date | null;
  followUpLabel: string;
  explanation: string[];
  factors: ScoreFactor[];
  computedAt: Date;
};

export type CustomerInsights = {
  leadSource: string;
  firstContactAt: Date;
  lastContactAt: Date;
  daysOpen: number;
  assignmentCount: number;
  recycleCount: number;
  currentOwner: string | null;
  currentStatus: string;
  score: number;
  scoreLabel: string;
  temperature: Temperature;
  recommendationLabel: string;
};

// Compose (but do NOT persist) the full insight from already-gathered signals.
async function composeFromSignals(s: InsightSignals): Promise<ComposedInsight> {
  const [score, baseRec] = await Promise.all([scoreLead(s.leadId), recommendNextAction(s.leadId)]);
  const factors = score?.factors ?? [];
  const scoreValue = score?.score ?? 0;

  const temperature = temperatureOf(scoreValue);
  const scoreLabel = scoreLabelOf(scoreValue, temperature, s);
  const tags = tagsOf(scoreValue, temperature, s);
  const rec = deriveRecommendation(baseRec?.action ?? "wait", baseRec?.reasoning ?? "", scoreValue, temperature, tags, s);
  const followUp = deriveFollowUp(rec, temperature, s);
  const summary = composeSummary(s, tags);
  const explanation = composeExplanation(score ?? { leadId: s.leadId, score: scoreValue, factors }, scoreLabel, temperature, tags, rec, s);

  return {
    leadId: s.leadId,
    companyId: s.companyId,
    score: scoreValue,
    scoreLabel,
    temperature,
    tags,
    summary,
    recommendation: rec.action,
    recommendationLabel: rec.label,
    recommendationReason: rec.reason,
    followUpAt: followUp.followUpAt,
    followUpLabel: followUp.label,
    explanation,
    factors,
    computedAt: new Date(),
  };
}

// Persist a composed insight (one row per lead — upsert on leadId).
async function persist(insight: ComposedInsight): Promise<void> {
  await db
    .insert(leadInsights)
    .values({
      leadId: insight.leadId,
      companyId: insight.companyId,
      score: insight.score,
      scoreLabel: insight.scoreLabel,
      temperature: insight.temperature,
      tags: insight.tags,
      summary: insight.summary,
      recommendation: insight.recommendation,
      recommendationLabel: insight.recommendationLabel,
      recommendationReason: insight.recommendationReason,
      followUpAt: insight.followUpAt,
      followUpLabel: insight.followUpLabel,
      explanation: insight.explanation,
      factors: insight.factors,
      version: INSIGHTS_ENGINE_VERSION,
      computedAt: insight.computedAt,
    })
    .onConflictDoUpdate({
      target: leadInsights.leadId,
      set: {
        score: insight.score,
        scoreLabel: insight.scoreLabel,
        temperature: insight.temperature,
        tags: insight.tags,
        summary: insight.summary,
        recommendation: insight.recommendation,
        recommendationLabel: insight.recommendationLabel,
        recommendationReason: insight.recommendationReason,
        followUpAt: insight.followUpAt,
        followUpLabel: insight.followUpLabel,
        explanation: insight.explanation,
        factors: insight.factors,
        version: INSIGHTS_ENGINE_VERSION,
        computedAt: insight.computedAt,
      },
    });
}

// Recompute + persist. Safe to call from the async queue (never throws to the
// caller path in practice — errors are logged). Returns the fresh insight, or
// null if the lead no longer exists.
export async function recomputeLeadInsights(leadId: string): Promise<ComposedInsight | null> {
  const signals = await gatherInsightSignals(leadId);
  if (!signals) return null;
  const insight = await composeFromSignals(signals);
  await persist(insight);
  logger.debug("insight_recomputed", { leadId, score: insight.score, label: insight.scoreLabel, action: insight.recommendation });
  return insight;
}

function buildCustomerInsights(s: InsightSignals, insight: ComposedInsight): CustomerInsights {
  return {
    leadSource: sourceLabel(s),
    firstContactAt: s.createdAt,
    lastContactAt: s.lastActivityAt,
    daysOpen: Math.max(0, Math.floor((Date.now() - s.createdAt.getTime()) / 86_400_000)),
    assignmentCount: s.assignmentCount,
    recycleCount: s.recycleCount,
    currentOwner: s.ownerName,
    currentStatus: s.disposition,
    score: insight.score,
    scoreLabel: insight.scoreLabel,
    temperature: insight.temperature,
    recommendationLabel: insight.recommendationLabel,
  };
}

function rowToInsight(row: typeof leadInsights.$inferSelect): ComposedInsight {
  return {
    leadId: row.leadId,
    companyId: row.companyId,
    score: row.score,
    scoreLabel: row.scoreLabel,
    temperature: row.temperature as Temperature,
    tags: (row.tags as string[]) ?? [],
    summary: row.summary,
    recommendation: row.recommendation as InsightAction,
    recommendationLabel: row.recommendationLabel,
    recommendationReason: row.recommendationReason,
    followUpAt: row.followUpAt,
    followUpLabel: row.followUpLabel,
    explanation: (row.explanation as string[]) ?? [],
    factors: (row.factors as ScoreFactor[]) ?? [],
    computedAt: row.computedAt,
  };
}

// Read the insight for a lead (company-scoped). Recomputes transparently if the
// cache is missing or older than the lead's most recent change/activity. Also
// returns the derived Customer Insights. Returns null if the lead isn't in this
// company (tenant isolation).
export async function getLeadInsights(
  leadId: string,
  companyId: string
): Promise<{ insight: ComposedInsight; customerInsights: CustomerInsights } | null> {
  const signals = await gatherInsightSignals(leadId);
  if (!signals || signals.companyId !== companyId) return null;

  const [existing] = await db.select().from(leadInsights).where(eq(leadInsights.leadId, leadId)).limit(1);
  const contentChangedAt = Math.max(signals.updatedAt.getTime(), signals.lastActivityAt.getTime());

  let insight: ComposedInsight;
  if (!existing || existing.computedAt.getTime() < contentChangedAt || existing.version !== INSIGHTS_ENGINE_VERSION) {
    insight = await composeFromSignals(signals);
    await persist(insight);
  } else {
    insight = rowToInsight(existing);
  }

  return { insight, customerInsights: buildCustomerInsights(signals, insight) };
}

// Compose without reading/writing the cache (used by the recompute queue seam
// and tests). Company scoping is the caller's responsibility.
export async function composeLeadInsights(leadId: string): Promise<ComposedInsight | null> {
  const signals = await gatherInsightSignals(leadId);
  if (!signals) return null;
  return composeFromSignals(signals);
}

// Delete a lead's cached insight (kept for completeness; cascade already
// removes it when the lead is deleted).
export async function clearLeadInsights(leadId: string, companyId: string): Promise<void> {
  await db.delete(leadInsights).where(and(eq(leadInsights.leadId, leadId), eq(leadInsights.companyId, companyId)));
}
