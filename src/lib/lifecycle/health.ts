// Assignment health + AI self-optimization metrics (Phase 4, backend only).
//
// getQueueHealth  — live operational gauges (queue depth, oldest queued, wait,
//                   dead-letter, latency) + process-lifetime counters.
// getSelfOptimizationMetrics — the ratios/timings that will later feed back
//                   into the AI's decisions (queue wait, success, abandonment,
//                   efficiency). All derived from data the engine already
//                   persists; no polling, bounded queries.
import { db } from "@/db";
import { assignmentHistory, assignmentJobs } from "@/db/schema";
import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import { metrics } from "@/lib/infra/metrics";

export interface QueueHealth {
  queueDepth: number; // pending + failed (waiting to (re)process)
  processing: number; // reserved by a worker right now
  deadLetterCount: number;
  oldestQueuedAgeSeconds: number | null;
  avgQueuedWaitSeconds: number | null; // current wait of items still in queue
  avgAssignmentLatencyMs: number | null; // over successful assignments, 24h
  counters: {
    retried: number;
    recovered: number;
    recycled: number;
    rebalanced: number;
    deadLettered: number;
    deadLetterRetried: number;
  };
}

export async function getQueueHealth(companyId?: string): Promise<QueueHealth> {
  const base: SQL | undefined = companyId ? eq(assignmentJobs.companyId, companyId) : undefined;

  const statusRows = await db
    .select({ status: assignmentJobs.status, n: sql<number>`count(*)::int` })
    .from(assignmentJobs)
    .where(base)
    .groupBy(assignmentJobs.status);
  const byStatus = new Map(statusRows.map((r) => [r.status, Number(r.n)]));

  const queuedFilter = companyId
    ? and(eq(assignmentJobs.companyId, companyId), sql`${assignmentJobs.status} in ('pending','failed')`)
    : sql`${assignmentJobs.status} in ('pending','failed')`;
  const [wait] = await db
    .select({
      oldest: sql<string | null>`extract(epoch from (now() - min(${assignmentJobs.createdAt})))`,
      avgWait: sql<string | null>`avg(extract(epoch from (now() - ${assignmentJobs.createdAt})))`,
    })
    .from(assignmentJobs)
    .where(queuedFilter);

  const since = new Date(Date.now() - 24 * 3600_000);
  const latFilter = companyId
    ? and(eq(assignmentHistory.companyId, companyId), eq(assignmentHistory.outcome, "assigned"), gte(assignmentHistory.createdAt, since))
    : and(eq(assignmentHistory.outcome, "assigned"), gte(assignmentHistory.createdAt, since));
  const [lat] = await db
    .select({ avg: sql<string | null>`avg(${assignmentHistory.processingTimeMs})` })
    .from(assignmentHistory)
    .where(latFilter);

  const snap = metrics.snapshot();
  return {
    queueDepth: (byStatus.get("pending") ?? 0) + (byStatus.get("failed") ?? 0),
    processing: byStatus.get("processing") ?? 0,
    deadLetterCount: byStatus.get("dead_letter") ?? 0,
    oldestQueuedAgeSeconds: wait?.oldest != null ? Math.round(Number(wait.oldest)) : null,
    avgQueuedWaitSeconds: wait?.avgWait != null ? Math.round(Number(wait.avgWait)) : null,
    avgAssignmentLatencyMs: lat?.avg != null ? Math.round(Number(lat.avg)) : null,
    // Counters are process-lifetime and system-wide (reset on restart).
    counters: {
      retried: snap["assignment.job_retried"],
      recovered: snap["assignment.recovered"],
      recycled: snap["assignment.recycled"],
      rebalanced: snap["assignment.rebalanced"],
      deadLettered: snap["assignment.job_dead_lettered"],
      deadLetterRetried: snap["assignment.dead_letter_retried"],
    },
  };
}

export interface SelfOptimizationMetrics {
  avgQueueWaitSeconds: number | null; // time from lead.queued -> assigned (24h, this company)
  assignmentSuccessRate: number | null; // assigned / (assigned + dead-lettered)
  assignmentEfficiency: number | null; // assigned / (assigned + retries) — first-try success
  leadAbandonmentRate: number | null; // recycled / assigned
}

export async function getSelfOptimizationMetrics(companyId: string): Promise<SelfOptimizationMetrics> {
  const snap = metrics.snapshot();
  const assigned = snap["assignment.assigned"];
  const deadLettered = snap["assignment.job_dead_lettered"];
  const retried = snap["assignment.job_retried"];
  const recycled = snap["assignment.recycled"];

  // Average queue wait: for each lead that entered "queued", the gap to its
  // next "assigned" transition, over the last 24h for this company.
  const res = await db.execute(sql`
    SELECT avg(extract(epoch from (a.created_at - q.created_at))) AS s
    FROM lead_lifecycle_events q
    JOIN LATERAL (
      SELECT created_at FROM lead_lifecycle_events a
      WHERE a.lead_id = q.lead_id AND a.to_stage = 'assigned' AND a.created_at > q.created_at
      ORDER BY a.created_at ASC LIMIT 1
    ) a ON true
    WHERE q.company_id = ${companyId} AND q.to_stage = 'queued' AND q.created_at > now() - interval '24 hours'
  `);
  const s = (res as unknown as { rows: { s: string | null }[] }).rows?.[0]?.s ?? null;

  return {
    avgQueueWaitSeconds: s != null ? Math.round(Number(s)) : null,
    assignmentSuccessRate: assigned + deadLettered > 0 ? round(assigned / (assigned + deadLettered)) : null,
    assignmentEfficiency: assigned + retried > 0 ? round(assigned / (assigned + retried)) : null,
    leadAbandonmentRate: assigned > 0 ? round(recycled / assigned) : null,
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
