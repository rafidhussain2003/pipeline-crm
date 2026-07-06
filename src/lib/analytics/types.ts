// Shared types for the analytics layer. Kept separate from the query
// functions (service.ts) and the pure calculators (kpis.ts) so each can be
// imported independently — a route that only needs a KPI calculation on
// data it already has doesn't need to pull in the DB-querying service.

export type DateRangeKey = "today" | "yesterday" | "week" | "month" | "custom";

export type DateRange = { from: Date; to: Date };

export type GroupedCount = { key: string; label: string; count: number };

export type LeadSummary = {
  total: number;
  range: DateRange;
};

export type ConversionFunnel = {
  stages: GroupedCount[];
  totalCount: number;
  wonCount: number;
  conversionRatePct: number;
};

export type TopPerformer = {
  agentId: string;
  name: string;
  leadsHandled: number;
  leadsWon: number;
};

export type AgentStats = {
  activeAgentCount: number;
  topPerformers: TopPerformer[];
  assignedCount: number;
  unassignedCount: number;
  assignmentSuccessRatePct: number;
};

export type CompanyGrowthStats = {
  currentAgentCount: number;
  agentCountAddedInRange: number;
  leadVolumeTrend: { date: string; count: number }[];
};

// Future-ready, not implemented: there is no deal/dollar-value field
// anywhere in the schema today (leads have no `value`/`amount` column).
// Defining the shape now means the moment that field exists, a real
// implementation slots in here without any caller needing to change — but
// building a function that returns fabricated numbers today would be
// actively misleading in a CRM dashboard.
export type RevenueStats = {
  totalRevenue: number;
  averageDealSize: number;
  wonDealCount: number;
  range: DateRange;
};
