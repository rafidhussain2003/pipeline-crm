// Lead scoring (Part 2) — a deterministic, explainable weighted-factor
// model, NOT an LLM call and not a trained ML model. This is a deliberate
// choice, not a shortcut: the inputs (disposition, tags, activity,
// reassignment count, source history) are all structured CRM data already
// in Postgres, and a transparent, auditable formula is more useful and
// more trustworthy for a CRM feature like this than an opaque model would
// be — every point awarded has a stated reason (see `factors` below).
//
// "Future revenue" is listed as an input but contributes 0 points: there
// is no deal-value field anywhere in the schema (same gap noted in the
// Phase 4 analytics report's RevenueStats type) — scored, not silently
// ignored, so it's visible in the breakdown rather than a hidden gap.
import { db } from "@/db";
import { dispositionOptions, leads } from "@/db/schema";
import { and, count, eq, inArray } from "drizzle-orm";
import { buildLeadContext } from "./context";
import { WON_DISPOSITIONS, isWonDisposition, percentage } from "../analytics/kpis";
import { isLostDisposition } from "@/lib/dispositions/taxonomy";

export type ScoreFactor = {
  label: string;
  points: number;
  maxPoints: number;
  reason: string;
};

export type LeadScore = {
  leadId: string;
  score: number; // 0-100, sum of factor points
  factors: ScoreFactor[];
};

const MAX_AGE_DAYS_FOR_FRESHNESS = 14; // a "New Lead" older than this gets no freshness points

export async function scoreLead(leadId: string): Promise<LeadScore | null> {
  const context = await buildLeadContext(leadId);
  if (!context) return null;

  const factors: ScoreFactor[] = [];

  // 1. Pipeline stage (30 pts) — how far along the company's own configured
  // disposition order this lead is. Already-won leads score the max here;
  // "Not Interested"-style terminal-negative dispositions aren't
  // distinguished from stage position alone, so this factor intentionally
  // only measures progress, not lost/won polarity (that's factor 2).
  const dispositionRows = await db
    .select({ label: dispositionOptions.label, sortOrder: dispositionOptions.sortOrder })
    .from(dispositionOptions)
    .where(eq(dispositionOptions.companyId, context.companyId));
  const currentDispositionRow = dispositionRows.find((d) => d.label === context.disposition);
  const maxSortOrder = dispositionRows.reduce((max, d) => Math.max(max, d.sortOrder), 0);
  // Lost dispositions sit at the END of the taxonomy's sort order (LOST /
  // OTHER groups), so the position ratio below would read a dead lead as
  // maximally progressed — they get 0 stage points instead, matching what
  // "progress" means.
  const stagePoints =
    isWonDisposition(context.disposition)
      ? 30
      : isLostDisposition(context.disposition)
        ? 0
        : currentDispositionRow && maxSortOrder > 0
          ? Math.round((currentDispositionRow.sortOrder / maxSortOrder) * 30)
          : 10;
  factors.push({
    label: "Pipeline stage",
    points: stagePoints,
    maxPoints: 30,
    reason:
      isWonDisposition(context.disposition)
        ? "Lead is already won"
        : isLostDisposition(context.disposition)
          ? `Disposition "${context.disposition}" is terminal — the lead is closed without a sale`
          : `Disposition "${context.disposition}" is ${currentDispositionRow ? `stage ${currentDispositionRow.sortOrder} of ${maxSortOrder}` : "not in this company's configured pipeline"}`,
  });

  // 2. Engagement / activity (20 pts) — notes and tags both indicate
  // someone has actually worked this lead, not just that it exists.
  const notePoints = Math.min(context.noteCount * 4, 12);
  const tagPoints = Math.min(context.tagLabels.length * 2, 8);
  factors.push({
    label: "Engagement",
    points: notePoints + tagPoints,
    maxPoints: 20,
    reason: `${context.noteCount} note(s), ${context.tagLabels.length} tag(s)`,
  });

  // 3. Freshness (15 pts) — a brand-new, untouched lead is time-sensitive;
  // one that's sat at "New Lead" for weeks is a cold-lead signal, not a
  // hot one.
  const ageDays = (Date.now() - context.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const freshnessPoints = context.disposition === "New Lead" ? Math.round(Math.max(0, 1 - ageDays / MAX_AGE_DAYS_FOR_FRESHNESS) * 15) : 8;
  factors.push({
    label: "Freshness",
    points: freshnessPoints,
    maxPoints: 15,
    reason: context.disposition === "New Lead" ? `${Math.round(ageDays)} day(s) old, still untouched` : "Already past the initial stage",
  });

  // 4. Assignment stability (15 pts) — a lead bounced between multiple
  // agents (recycled repeatedly) is a weaker signal than one that's been
  // handled consistently.
  const stabilityPoints = context.reassignmentCount <= 1 ? 15 : Math.max(0, 15 - (context.reassignmentCount - 1) * 5);
  factors.push({
    label: "Assignment stability",
    points: stabilityPoints,
    maxPoints: 15,
    reason: `Assigned ${context.reassignmentCount} time(s)`,
  });

  // 5. Source quality (20 pts) — this source's historical won-rate for
  // this company. Bounded, indexed query (leads_email_idx's sibling
  // company-scoped filters apply here too) — not a full-table scan.
  let sourcePoints = 10; // neutral default when source is unknown/manual
  let sourceReason = "No source recorded (manual entry) — using a neutral score";
  if (context.sourceId) {
    const [{ value: totalFromSource }] = await db
      .select({ value: count() })
      .from(leads)
      .where(and(eq(leads.companyId, context.companyId), eq(leads.sourceId, context.sourceId)));
    const [{ value: wonFromSource }] = await db
      .select({ value: count() })
      .from(leads)
      .where(and(eq(leads.companyId, context.companyId), eq(leads.sourceId, context.sourceId), inArray(leads.disposition, WON_DISPOSITIONS)));
    const winRate = percentage(wonFromSource, totalFromSource);
    sourcePoints = Math.round((winRate / 100) * 20);
    sourceReason = `This source has a ${winRate}% historical win rate (${wonFromSource}/${totalFromSource} leads)`;
  }
  factors.push({ label: "Source quality", points: sourcePoints, maxPoints: 20, reason: sourceReason });

  // 6. Future revenue (0 pts) — see file-level comment.
  factors.push({ label: "Future revenue", points: 0, maxPoints: 0, reason: "Not scored: no deal-value field exists in the schema yet" });

  const score = Math.max(0, Math.min(100, factors.reduce((sum, f) => sum + f.points, 0)));
  return { leadId, score, factors };
}
