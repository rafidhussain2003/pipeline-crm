// Public surface of the Lead Insights module (Phase 9). An ISOLATED extension:
// it composes the existing deterministic AI engine (src/lib/ai) + this phase's
// classification into a persisted, auto-updating per-lead insight for the Lead
// Details card. It does NOT modify the CRM, Assignment Engine, Website Forms,
// Meta, Operations Center, Mailbox, Billing, or Auth. All recompute work is
// asynchronous (see ./queue), so nothing here can slow lead assignment.
export { getLeadInsights, recomputeLeadInsights, composeLeadInsights, clearLeadInsights, INSIGHTS_ENGINE_VERSION } from "./service";
export type { ComposedInsight, CustomerInsights } from "./service";
export { enqueueInsightsRecompute, flushInsightsQueue, pendingInsightsCount } from "./queue";
export { gatherInsightSignals, sourceLabel } from "./signals";
export type { InsightSignals } from "./signals";
export { buildLeadTimeline } from "./timeline";
export type { TimelineEvent } from "./timeline";
export type { Temperature, InsightAction, Recommendation, FollowUp } from "./classify";
