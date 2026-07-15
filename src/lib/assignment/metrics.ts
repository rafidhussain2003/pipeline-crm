// Internal assignment metrics (Phase 1 — collection only, no UI).
//
// Two sources, deliberately: process-lifetime COUNTERS (from the in-memory
// metrics registry — cheap, reset on restart, "what has this instance done")
// and durable GAUGES computed on demand from the DB ("what is true right
// now", survives restarts and is correct across instances). Together they
// answer the five things the spec asks to track: assignments completed,
// assignments failed, queue size, average processing time, retry count.
import { db } from "@/db";
import { assignmentHistory, assignmentJobs } from "@/db/schema";
import { and, count, eq, sql, type SQL } from "drizzle-orm";
import { metrics } from "@/lib/infra/metrics";

export interface AssignmentMetricsSnapshot {
  // Process-lifetime counters (since last restart).
  counters: {
    completed: number;
    failed: number;
    enqueued: number;
    retried: number;
    deadLettered: number;
  };
  // Live, durable gauges.
  queue: {
    pending: number; // waiting or scheduled for retry
    processing: number; // reserved by a worker right now
    deadLetter: number; // exhausted retries (job stopped; lead still safe)
  };
  // Average end-to-end processing time (ms) over successful decisions.
  avgProcessingMs: number | null;
}

export async function getAssignmentMetrics(companyId?: string): Promise<AssignmentMetricsSnapshot> {
  const snap = metrics.snapshot();

  const jobFilter: SQL | undefined = companyId ? eq(assignmentJobs.companyId, companyId) : undefined;
  const jobRows = await db
    .select({ status: assignmentJobs.status, n: count() })
    .from(assignmentJobs)
    .where(jobFilter)
    .groupBy(assignmentJobs.status);
  const byStatus = new Map(jobRows.map((r) => [r.status, r.n]));

  const historyFilter: SQL | undefined = companyId
    ? and(eq(assignmentHistory.companyId, companyId), eq(assignmentHistory.outcome, "assigned"))
    : eq(assignmentHistory.outcome, "assigned");
  const [avgRow] = await db
    .select({ avg: sql<string | null>`avg(${assignmentHistory.processingTimeMs})` })
    .from(assignmentHistory)
    .where(historyFilter);

  return {
    counters: {
      completed: snap["assignment.assigned"],
      failed: snap["assignment.failed"],
      enqueued: snap["assignment.job_enqueued"],
      retried: snap["assignment.job_retried"],
      deadLettered: snap["assignment.job_dead_lettered"],
    },
    queue: {
      pending: (byStatus.get("pending") ?? 0) + (byStatus.get("failed") ?? 0),
      processing: byStatus.get("processing") ?? 0,
      deadLetter: byStatus.get("dead_letter") ?? 0,
    },
    avgProcessingMs: avgRow?.avg != null ? Math.round(Number(avgRow.avg)) : null,
  };
}
