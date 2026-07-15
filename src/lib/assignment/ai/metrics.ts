// AI analytics — backend metrics only (no UI this phase).
//
// Everything here is derived from what the pipeline already persists in
// assignment_history (final_score, decision_detail, processing_time_ms,
// assigned_to, created_at) plus two light live queries, over a bounded time
// window, so it is cheap to compute on demand.
import { db } from "@/db";
import { assignmentHistory, leads, users } from "@/db/schema";
import { and, desc, eq, gte, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { TERMINAL_DISPOSITIONS } from "../constants";
import { getAIConfig } from "./config";

const DEFAULT_WINDOW_HOURS = 24;
const DETAIL_SAMPLE_LIMIT = 500;

export interface AIMetricsSnapshot {
  windowHours: number;
  totalAssignments: number;
  avgAssignmentTimeMs: number | null;
  avgAIScore: number | null;
  assignmentsPerAgent: { agentId: string; count: number }[];
  assignmentsPerHour: { hour: string; count: number }[];
  rejectedReasons: { reason: string; count: number }[];
  skippedAgentCount: number;
  fairnessScore: number | null; // Jain's index, 1 = perfectly even
  capacityUtilization: number | null; // avg open leads / maxActiveLeads
  idleDistribution: { bucket: string; count: number }[];
}

// Jain's fairness index over per-agent counts: (Σx)² / (n·Σx²). In [1/n, 1];
// 1 = every agent got the same number of leads. The standard, bounded fairness
// measure — better than a raw stddev because it's already normalized.
function jainFairness(counts: number[]): number | null {
  if (counts.length === 0) return null;
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum === 0) return 1; // nobody assigned yet -> trivially fair
  const sumSq = counts.reduce((a, b) => a + b * b, 0);
  return (sum * sum) / (counts.length * sumSq);
}

export async function getAIMetrics(companyId: string, windowHours = DEFAULT_WINDOW_HOURS): Promise<AIMetricsSnapshot> {
  const since = new Date(Date.now() - windowHours * 3600_000);
  const assignedInWindow = and(
    eq(assignmentHistory.companyId, companyId),
    eq(assignmentHistory.outcome, "assigned"),
    gte(assignmentHistory.createdAt, since)
  );

  // Scalars + per-agent + per-hour in a few grouped queries.
  const [scalars] = await db
    .select({
      total: sql<number>`count(*)::int`,
      avgTime: sql<number | null>`avg(${assignmentHistory.processingTimeMs})`,
      avgScore: sql<number | null>`avg(${assignmentHistory.finalScore})`,
    })
    .from(assignmentHistory)
    .where(assignedInWindow);

  const perAgentRows = await db
    .select({ agentId: assignmentHistory.assignedTo, count: sql<number>`count(*)::int` })
    .from(assignmentHistory)
    .where(assignedInWindow)
    .groupBy(assignmentHistory.assignedTo);
  const assignmentsPerAgent = perAgentRows
    .filter((r) => r.agentId)
    .map((r) => ({ agentId: r.agentId as string, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);

  const perHourRows = await db
    .select({ hour: sql<string>`to_char(date_trunc('hour', ${assignmentHistory.createdAt}), 'YYYY-MM-DD HH24:00')`, count: sql<number>`count(*)::int` })
    .from(assignmentHistory)
    .where(assignedInWindow)
    .groupBy(sql`date_trunc('hour', ${assignmentHistory.createdAt})`)
    .orderBy(sql`date_trunc('hour', ${assignmentHistory.createdAt})`);
  const assignmentsPerHour = perHourRows.map((r) => ({ hour: r.hour, count: Number(r.count) }));

  // Rejected reasons + skipped agents: tally from a bounded sample of recent
  // decision details (jsonb is awkward to aggregate in SQL; JS over a capped
  // sample is simpler and cheap).
  const detailRows = await db
    .select({ detail: assignmentHistory.decisionDetail })
    .from(assignmentHistory)
    .where(and(eq(assignmentHistory.companyId, companyId), isNotNull(assignmentHistory.decisionDetail), gte(assignmentHistory.createdAt, since)))
    .orderBy(desc(assignmentHistory.createdAt))
    .limit(DETAIL_SAMPLE_LIMIT);
  const reasonCounts = new Map<string, number>();
  const skippedAgents = new Set<string>();
  for (const row of detailRows) {
    const rejected = (row.detail as { rejected?: { agentId: string; reason: string }[] } | null)?.rejected ?? [];
    for (const r of rejected) {
      // Normalize a reason to its kind (drop the numbers) so "over_capacity(...)"
      // rows aggregate together.
      const kind = r.reason.replace(/\(.*\)$/, "").replace(/:.*$/, "");
      reasonCounts.set(kind, (reasonCounts.get(kind) ?? 0) + 1);
      skippedAgents.add(r.agentId);
    }
  }
  const rejectedReasons = [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

  // Live capacity utilization: avg open (non-terminal) leads per agent / cap.
  const config = await getAIConfig(companyId);
  const openRows = await db
    .select({ ownerId: leads.ownerId, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), isNotNull(leads.ownerId), isNull(leads.deletedAt), notInArray(leads.disposition, TERMINAL_DISPOSITIONS)))
    .groupBy(leads.ownerId);
  let capacityUtilization: number | null = null;
  if (config.capacity.maxActiveLeads && openRows.length > 0) {
    const avgOpen = openRows.reduce((a, r) => a + Number(r.n), 0) / openRows.length;
    capacityUtilization = Math.round((avgOpen / config.capacity.maxActiveLeads) * 1000) / 1000;
  }

  // Idle distribution across active agents.
  const agents = await db
    .select({ lastAssignedAt: users.lastAssignedAt })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "agent"), eq(users.active, true), isNull(users.deletedAt)));
  const buckets = { "<1m": 0, "1-5m": 0, "5-30m": 0, "30m-2h": 0, ">2h": 0, never: 0 };
  const now = Date.now();
  for (const a of agents) {
    if (!a.lastAssignedAt) { buckets.never++; continue; }
    const m = (now - a.lastAssignedAt.getTime()) / 60_000;
    if (m < 1) buckets["<1m"]++;
    else if (m < 5) buckets["1-5m"]++;
    else if (m < 30) buckets["5-30m"]++;
    else if (m < 120) buckets["30m-2h"]++;
    else buckets[">2h"]++;
  }
  const idleDistribution = Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));

  return {
    windowHours,
    totalAssignments: Number(scalars?.total ?? 0),
    avgAssignmentTimeMs: scalars?.avgTime != null ? Math.round(Number(scalars.avgTime)) : null,
    avgAIScore: scalars?.avgScore != null ? Math.round(Number(scalars.avgScore) * 1000) / 1000 : null,
    assignmentsPerAgent,
    assignmentsPerHour,
    rejectedReasons,
    skippedAgentCount: skippedAgents.size,
    fairnessScore: jainFairness(assignmentsPerAgent.map((a) => a.count)),
    capacityUtilization,
    idleDistribution,
  };
}
