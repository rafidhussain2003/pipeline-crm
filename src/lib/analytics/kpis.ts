// Pure KPI calculators — each takes already-fetched numbers/rows and
// returns a derived metric. No DB access here on purpose: this is the one
// place each formula is defined, so "conversion rate" (for example) is
// computed identically everywhere it's used, rather than each dashboard
// widget/report reimplementing (and potentially diverging on) the same
// percentage calculation.

export function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // one decimal place
}

// "Won" is defined by membership in WON_DISPOSITIONS (the enterprise
// taxonomy's SALES labels plus the legacy "Sold" every pre-taxonomy company
// was seeded with) — see src/lib/dispositions/taxonomy.ts, the single
// source of truth. Re-exported here because this file is the historical
// home every analytics/AI consumer already imports "what counts as won"
// from.
export { WON_DISPOSITIONS, isWonDisposition } from "@/lib/dispositions/taxonomy";

export function calculateConversionRate(totalLeads: number, wonLeads: number): number {
  return percentage(wonLeads, totalLeads);
}

export function calculateAssignmentSuccessRate(totalLeads: number, assignedLeads: number): number {
  return percentage(assignedLeads, totalLeads);
}

// Average age (in hours) of leads that are still open (not yet won), based
// on time since creation. This is a straightforward, accurate metric — it
// only needs `createdAt`, which every lead has.
export function calculateAverageLeadAgeHours(createdAtTimestamps: Date[], now: Date = new Date()): number {
  if (createdAtTimestamps.length === 0) return 0;
  const totalMs = createdAtTimestamps.reduce((sum, createdAt) => sum + (now.getTime() - createdAt.getTime()), 0);
  const avgMs = totalMs / createdAtTimestamps.length;
  return Math.round((avgMs / (1000 * 60 * 60)) * 10) / 10;
}

// Approximate pipeline velocity: average time (in hours) from lead
// creation to the lead's last update, for leads currently at the "won"
// disposition. This is an approximation, not a precise "time to close" —
// `updatedAt` reflects the most recent change to the row, which is usually
// (but not guaranteed to be) the disposition change to "won". A precise
// version would read the first `lead.disposition_changed` audit log entry
// where metadata.to is a won disposition instead of `leads.updatedAt` —
// noted as a Phase 5 recommendation rather than built now, to avoid a
// JSONB-path query this pass didn't need to introduce.
export function calculateAveragePipelineVelocityHours(wonLeads: { createdAt: Date; updatedAt: Date }[]): number {
  if (wonLeads.length === 0) return 0;
  const totalMs = wonLeads.reduce((sum, lead) => sum + (lead.updatedAt.getTime() - lead.createdAt.getTime()), 0);
  const avgMs = totalMs / wonLeads.length;
  return Math.round((avgMs / (1000 * 60 * 60)) * 10) / 10;
}

// Source quality: what fraction of leads from a given source convert.
// Same underlying formula as calculateConversionRate — exposed separately
// because "source quality" is a distinct KPI concept callers reach for by
// name, even though the math is identical (single implementation, per the
// "every KPI has one implementation" requirement).
export const calculateSourceQuality = calculateConversionRate;

export function calculateGrowthRate(previousCount: number, currentCount: number): number {
  if (previousCount <= 0) return currentCount > 0 ? 100 : 0;
  return percentage(currentCount - previousCount, previousCount);
}
