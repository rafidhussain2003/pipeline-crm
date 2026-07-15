// Phase 12 — background job monitoring. Aggregates the two durable queues
// (assignment_jobs, capi_events) into one operator view: running / queued /
// failed / dead-letter counts, retry counts, average processing time, plus the
// in-process job counters. Read-only + bounded; powers the super-admin Jobs
// dashboard. Retry is delegated to each queue's own idempotent retry path.
import { db } from "@/db";
import { assignmentJobs, assignmentHistory, capiEvents } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { metrics } from "@/lib/infra/metrics";

export interface QueueStats {
  name: string;
  running: number; // reserved by a worker right now
  queued: number; // pending + failed (waiting / retrying)
  deadLetter: number;
  completedOrSent: number; // process-lifetime (from metrics)
  retried: number; // process-lifetime (from metrics)
  avgProcessingMs: number | null;
  deadLetterJobs: { id: string; leadId: string | null; attempts: number; lastError: string | null; updatedAt: Date }[];
}

export interface JobDashboard {
  queues: QueueStats[];
  workers: { assignmentWorker: string; capiWorker: string; note: string };
  generatedAt: string;
}

async function assignmentStats(): Promise<QueueStats> {
  const statusRows = await db.select({ status: assignmentJobs.status, n: sql<number>`count(*)::int` }).from(assignmentJobs).groupBy(assignmentJobs.status);
  const by = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
  const since = new Date(Date.now() - 24 * 3600_000);
  const [lat] = await db.select({ avg: sql<number | null>`avg(${assignmentHistory.processingTimeMs})` }).from(assignmentHistory).where(and(eq(assignmentHistory.outcome, "assigned"), gte(assignmentHistory.createdAt, since)));
  const dead = await db
    .select({ id: assignmentJobs.id, leadId: assignmentJobs.leadId, attempts: assignmentJobs.attempts, lastError: assignmentJobs.lastError, updatedAt: assignmentJobs.updatedAt })
    .from(assignmentJobs)
    .where(eq(assignmentJobs.status, "dead_letter"))
    .limit(50);
  const snap = metrics.snapshot();
  return {
    name: "assignment",
    running: by.get("processing") ?? 0,
    queued: (by.get("pending") ?? 0) + (by.get("failed") ?? 0),
    deadLetter: by.get("dead_letter") ?? 0,
    completedOrSent: snap["assignment.job_completed"],
    retried: snap["assignment.job_retried"],
    avgProcessingMs: lat?.avg != null ? Math.round(Number(lat.avg)) : null,
    deadLetterJobs: dead,
  };
}

async function capiStats(): Promise<QueueStats> {
  const statusRows = await db.select({ status: capiEvents.status, n: sql<number>`count(*)::int`, avg: sql<number | null>`avg(${capiEvents.latencyMs})` }).from(capiEvents).groupBy(capiEvents.status);
  const by = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
  const sentAvg = statusRows.find((r) => r.status === "sent")?.avg ?? null;
  const totalRetried = await db.select({ n: sql<number>`coalesce(sum(${capiEvents.attempts}),0)::int` }).from(capiEvents).where(sql`${capiEvents.attempts} > 1`);
  const dead = await db
    .select({ id: capiEvents.id, leadId: capiEvents.leadId, attempts: capiEvents.attempts, lastError: capiEvents.lastError, updatedAt: capiEvents.updatedAt })
    .from(capiEvents)
    .where(eq(capiEvents.status, "dead_letter"))
    .limit(50);
  return {
    name: "conversions_api",
    running: by.get("processing") ?? 0,
    queued: (by.get("pending") ?? 0) + (by.get("failed") ?? 0),
    deadLetter: by.get("dead_letter") ?? 0,
    completedOrSent: by.get("sent") ?? 0,
    retried: Number(totalRetried[0]?.n ?? 0),
    avgProcessingMs: sentAvg != null ? Math.round(Number(sentAvg)) : null,
    deadLetterJobs: dead,
  };
}

export async function getJobDashboard(): Promise<JobDashboard> {
  const [assignment, capi] = await Promise.all([assignmentStats(), capiStats()]);
  return {
    queues: [assignment, capi],
    workers: {
      assignmentWorker: "in-process (event-kicked + cron backstop)",
      capiWorker: "in-process (event-kicked + cron backstop)",
      note: "Workers are stateless and horizontally scalable — durable rows + FOR UPDATE SKIP LOCKED mean any instance can drain safely.",
    },
    generatedAt: new Date().toISOString(),
  };
}

// Retry a dead-lettered job (super-admin, cross-company). Idempotent: re-queues
// the row (status back to pending, available now) so the normal worker path
// re-attempts it. Returns whether a row was updated.
export async function retryDeadLetterJob(queue: string, id: string): Promise<boolean> {
  if (queue === "assignment") {
    const res = await db
      .update(assignmentJobs)
      .set({ status: "pending", availableAt: new Date(), attempts: 0, lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(and(eq(assignmentJobs.id, id), eq(assignmentJobs.status, "dead_letter")))
      .returning({ id: assignmentJobs.id });
    return res.length > 0;
  }
  if (queue === "conversions_api") {
    const res = await db
      .update(capiEvents)
      .set({ status: "pending", availableAt: new Date(), lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(and(eq(capiEvents.id, id), eq(capiEvents.status, "dead_letter")))
      .returning({ id: capiEvents.id });
    return res.length > 0;
  }
  return false;
}
