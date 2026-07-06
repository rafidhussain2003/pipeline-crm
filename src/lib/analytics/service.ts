// Analytics service — every function here is a small, fixed number of
// aggregate SQL queries (COUNT/GROUP BY), never "fetch every row and count
// in Node." That's the one rule that actually matters for this to survive
// 50M+ leads: the query cost must depend on the date range and grouping,
// not on total table size, and every filter here rides an existing index
// (leads_company_idx, leads_created_idx, leads_disposition_idx,
// leads_owner_idx — all already in place).
import { db } from "@/db";
import { leads, leadSources, users } from "@/db/schema";
import { and, count, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { AgentStats, CompanyGrowthStats, ConversionFunnel, DateRange, GroupedCount, LeadSummary, TopPerformer } from "./types";
import { WON_DISPOSITION, calculateAssignmentSuccessRate, calculateConversionRate } from "./kpis";

function leadsInRange(companyId: string, range: DateRange) {
  return and(eq(leads.companyId, companyId), isNull(leads.deletedAt), gte(leads.createdAt, range.from), lte(leads.createdAt, range.to));
}

export async function getLeadSummary(companyId: string, range: DateRange): Promise<LeadSummary> {
  const [{ value: total }] = await db.select({ value: count() }).from(leads).where(leadsInRange(companyId, range));
  return { total, range };
}

export type GroupByField = "disposition" | "source" | "agent";

export async function getLeadsGroupedBy(companyId: string, range: DateRange, groupBy: GroupByField): Promise<GroupedCount[]> {
  if (groupBy === "disposition") {
    const rows = await db
      .select({ key: leads.disposition, count: count() })
      .from(leads)
      .where(leadsInRange(companyId, range))
      .groupBy(leads.disposition)
      .orderBy(desc(count()));
    return rows.map((r) => ({ key: r.key, label: r.key, count: r.count }));
  }

  if (groupBy === "source") {
    const rows = await db
      .select({ sourceId: leads.sourceId, pageName: leadSources.pageName, platform: leadSources.platform, count: count() })
      .from(leads)
      .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
      .where(leadsInRange(companyId, range))
      .groupBy(leads.sourceId, leadSources.pageName, leadSources.platform)
      .orderBy(desc(count()));
    return rows.map((r) => ({
      key: r.sourceId || "manual",
      label: r.pageName || r.platform || "Manual / Direct",
      count: r.count,
    }));
  }

  // groupBy === "agent"
  const rows = await db
    .select({ ownerId: leads.ownerId, name: users.name, count: count() })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(leadsInRange(companyId, range))
    .groupBy(leads.ownerId, users.name)
    .orderBy(desc(count()));
  return rows.map((r) => ({ key: r.ownerId || "unassigned", label: r.name || "Unassigned", count: r.count }));
}

export async function getConversionFunnel(companyId: string, range: DateRange): Promise<ConversionFunnel> {
  const stages = await getLeadsGroupedBy(companyId, range, "disposition");
  const totalCount = stages.reduce((sum, s) => sum + s.count, 0);
  const wonCount = stages.find((s) => s.key === WON_DISPOSITION)?.count || 0;
  return { stages, totalCount, wonCount, conversionRatePct: calculateConversionRate(totalCount, wonCount) };
}

export async function getAgentStats(companyId: string, range: DateRange): Promise<AgentStats> {
  const [{ value: activeAgentCount }] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "agent"), eq(users.active, true), isNull(users.deletedAt)));

  const rangeFilter = leadsInRange(companyId, range);

  const [{ value: totalInRange }] = await db.select({ value: count() }).from(leads).where(rangeFilter);
  const [{ value: assignedCount }] = await db
    .select({ value: count() })
    .from(leads)
    .where(and(rangeFilter, isNotNull(leads.ownerId)));

  const handledRows = await db
    .select({ agentId: leads.ownerId, name: users.name, handled: count() })
    .from(leads)
    .innerJoin(users, eq(leads.ownerId, users.id))
    .where(and(rangeFilter, isNotNull(leads.ownerId)))
    .groupBy(leads.ownerId, users.name);

  const wonRows = await db
    .select({ agentId: leads.ownerId, won: count() })
    .from(leads)
    .where(and(rangeFilter, isNotNull(leads.ownerId), eq(leads.disposition, WON_DISPOSITION)))
    .groupBy(leads.ownerId);
  const wonByAgent = new Map(wonRows.map((r) => [r.agentId, r.won]));

  const topPerformers: TopPerformer[] = handledRows
    .filter((r) => r.agentId !== null)
    .map((r) => ({
      agentId: r.agentId!,
      name: r.name || "Unknown",
      leadsHandled: r.handled,
      leadsWon: wonByAgent.get(r.agentId!) || 0,
    }))
    .sort((a, b) => b.leadsHandled - a.leadsHandled)
    .slice(0, 10);

  return {
    activeAgentCount,
    topPerformers,
    assignedCount,
    unassignedCount: totalInRange - assignedCount,
    assignmentSuccessRatePct: calculateAssignmentSuccessRate(totalInRange, assignedCount),
  };
}

export async function getCompanyGrowthStats(companyId: string, range: DateRange): Promise<CompanyGrowthStats> {
  const [{ value: currentAgentCount }] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "agent"), isNull(users.deletedAt)));

  const [{ value: agentCountAddedInRange }] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "agent"), gte(users.createdAt, range.from), lte(users.createdAt, range.to)));

  // Reusing the exact same SQL fragment reference in select/groupBy/orderBy
  // (rather than three separately-written but "equivalent" expressions)
  // guarantees Postgres treats them as the identical grouping key.
  const dayBucket = sql<string>`date_trunc('day', ${leads.createdAt})::date::text`;
  const trendRows = await db
    .select({ date: dayBucket, count: count() })
    .from(leads)
    .where(leadsInRange(companyId, range))
    .groupBy(dayBucket)
    .orderBy(dayBucket);

  return {
    currentAgentCount,
    agentCountAddedInRange,
    leadVolumeTrend: trendRows.map((r) => ({ date: r.date, count: r.count })),
  };
}
