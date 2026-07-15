// The durable assignment queue + its worker.
//
// This is the horizontally-scalable core of the engine. Work is durable rows
// in assignment_jobs (survives restarts, not held in process memory), and
// the worker reserves due rows with `FOR UPDATE SKIP LOCKED` — the standard
// Postgres-as-a-queue primitive that lets any number of future worker
// processes / app instances drain the same queue CONCURRENTLY with zero
// double-processing and zero blocking (a busy row is skipped, not waited on).
//
// The public surface is the AssignmentQueue interface: enqueue / reserveDue /
// complete / retryOrDeadLetter / size. A Redis/BullMQ backend later
// implements the same interface; nothing that calls it changes.
//
// There is NO polling loop here. The worker runs only when kicked
// (enqueue, agent-becomes-available, or the cron backstop), drains until
// empty, and stops. Time-based retries are picked up by the next kick or the
// cron backstop — never by a busy-wait.
import { db } from "@/db";
import { assignmentJobs, leads } from "@/db/schema";
import { and, count, eq, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/infra/metrics";
import { assignmentEvents } from "./events";
import { runPipeline } from "./pipeline";
import { getQueueConfig } from "@/lib/lifecycle/config";
import { computeLeadPriority } from "@/lib/lifecycle/priority";
import { classifyLeadSla, slaDeadlineFrom } from "@/lib/lifecycle/sla";
import type { AssignSource } from "./types";

const logger = createLogger({ component: "assignment-queue-worker" });

// Retry policy. Exponential backoff bounds how hard a stuck lead is retried;
// maxAttempts stops it being retried forever. Dead-lettering a JOB never
// loses the LEAD — the lead keeps ownerId=NULL and the reactive owner-NULL
// sweep (assignment-queue.ts) remains its ultimate backstop.
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

// Identifies which worker reserved a row — observability only; SKIP LOCKED
// provides the real mutual exclusion.
const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export interface AssignmentJobInput {
  leadId: string;
  companyId: string;
  requiredSkillId?: string | null;
  excludeAgentId?: string | null;
  source: AssignSource;
}

interface ReservedJob {
  id: string;
  companyId: string;
  leadId: string;
  attempts: number;
  maxAttempts: number;
  requiredSkillId: string | null;
  excludeAgentId: string | null;
  source: string;
}

export interface AssignmentQueue {
  enqueue(input: AssignmentJobInput): Promise<void>;
  reserveDue(limit: number): Promise<ReservedJob[]>;
  complete(jobId: string): Promise<void>;
  retryOrDeadLetter(job: ReservedJob, error: string): Promise<void>;
  size(companyId?: string): Promise<number>;
  // Recovery: return jobs stuck in "processing" (a worker reserved them then
  // died) to "pending" once their reservation has timed out — nothing gets
  // permanently stuck. Returns how many were reclaimed.
  reclaimStaleJobs(reservationTimeoutSeconds: number): Promise<number>;
}

class PostgresAssignmentQueue implements AssignmentQueue {
  // Idempotent: the partial unique index (one live job per lead) makes a
  // second enqueue for an already-queued lead a no-op via ON CONFLICT DO
  // NOTHING — so arrival-failure enqueue, an explicit enqueue, and a sweep
  // can all target the same lead without ever creating duplicate work.
  async enqueue(input: AssignmentJobInput): Promise<void> {
    // Compute the queue priority + SLA deadline from the lead + company config
    // so the worker drains hottest-first and overdue leads can be escalated.
    // Best-effort: any failure just leaves priority 0 / no deadline.
    let priority = 0;
    let slaDeadline: Date | null = null;
    try {
      const [lead] = await db
        .select({ priority: leads.priority, createdAt: leads.createdAt, followUpAt: leads.followUpAt })
        .from(leads)
        .where(eq(leads.id, input.leadId))
        .limit(1);
      if (lead) {
        const cfg = await getQueueConfig(input.companyId);
        priority = computeLeadPriority(lead, cfg);
        const sla = classifyLeadSla(lead, cfg);
        slaDeadline = slaDeadlineFrom(new Date(), sla.targetSeconds);
      }
    } catch {
      /* priority/SLA are best-effort; never block enqueue */
    }

    const inserted = await db
      .insert(assignmentJobs)
      .values({
        companyId: input.companyId,
        leadId: input.leadId,
        requiredSkillId: input.requiredSkillId ?? null,
        excludeAgentId: input.excludeAgentId ?? null,
        source: input.source,
        status: "pending",
        priority,
        slaDeadline,
        // availableAt intentionally omitted -> column default now() (the DB's
        // OWN clock). Scheduling must never be generated from the caller's
        // clock and then compared against the DB's now() in reserveDue: any
        // skew between an app instance and the DB would make a just-enqueued
        // job look "not yet due". Server-side time on both ends is skew-proof.
      })
      .onConflictDoNothing()
      .returning({ id: assignmentJobs.id });

    if (inserted.length > 0) {
      metrics.increment("assignment.job_enqueued");
      await assignmentEvents.queued(input.leadId, input.companyId, input.source as AssignSource);
    }
  }

  // Atomically reserve up to `limit` DUE rows (pending/failed, available_at
  // reached) and flip them to `processing` in a single statement. SKIP
  // LOCKED means concurrent workers each get a disjoint set with no waiting.
  async reserveDue(limit: number): Promise<ReservedJob[]> {
    const reserveStart = Date.now();
    const res = await db.execute(sql`
      UPDATE assignment_jobs SET status = 'processing', locked_at = now(), locked_by = ${WORKER_ID}, updated_at = now()
      WHERE id IN (
        SELECT id FROM assignment_jobs
        WHERE status IN ('pending', 'failed') AND available_at <= now()
        ORDER BY priority DESC, available_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING id, company_id, lead_id, attempts, max_attempts, required_skill_id, exclude_agent_id, source
    `);
    metrics.recordTiming("queue.reserve_ms", Date.now() - reserveStart);
    const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
    return rows.map((r) => ({
      id: r.id as string,
      companyId: r.company_id as string,
      leadId: r.lead_id as string,
      attempts: Number(r.attempts),
      maxAttempts: Number(r.max_attempts),
      requiredSkillId: (r.required_skill_id as string | null) ?? null,
      excludeAgentId: (r.exclude_agent_id as string | null) ?? null,
      source: r.source as string,
    }));
  }

  // Success (or a terminal non-retryable outcome): the job's work is done, so
  // remove the row. The permanent record lives in assignment_history, not
  // here — the queue table stays small (only live work).
  async complete(jobId: string): Promise<void> {
    await db.delete(assignmentJobs).where(eq(assignmentJobs.id, jobId));
    metrics.increment("assignment.job_completed");
  }

  async retryOrDeadLetter(job: ReservedJob, error: string): Promise<void> {
    const attempts = job.attempts + 1;
    if (attempts >= job.maxAttempts) {
      await db
        .update(assignmentJobs)
        .set({ status: "dead_letter", attempts, lastError: error, lockedAt: null, lockedBy: null, updatedAt: new Date() })
        .where(eq(assignmentJobs.id, job.id));
      metrics.increment("assignment.job_dead_lettered");
      logger.warn("job_dead_lettered", { jobId: job.id, leadId: job.leadId, attempts, error });
      // Final failure signal for this lead's queued life (the lead itself is
      // still safe — see the retry-policy note above).
      await assignmentEvents.failed(job.leadId, job.companyId, `dead_letter:${error}`, attempts);
      return;
    }
    const backoffSeconds = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS) / 1000;
    await db
      .update(assignmentJobs)
      .set({
        status: "pending",
        attempts,
        // Server-side scheduling (DB now() + interval), skew-proof — see the
        // note in enqueue() for why the caller's clock is never used here.
        availableAt: sql`now() + make_interval(secs => ${backoffSeconds})`,
        lastError: error,
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(assignmentJobs.id, job.id));
    metrics.increment("assignment.job_retried");
    logger.debug("job_retry_scheduled", { jobId: job.id, leadId: job.leadId, attempts, backoffSeconds });
  }

  async size(companyId?: string): Promise<number> {
    const filter: SQL | undefined = companyId
      ? and(eq(assignmentJobs.companyId, companyId), sql`${assignmentJobs.status} in ('pending','failed')`)
      : sql`${assignmentJobs.status} in ('pending','failed')`;
    const [row] = await db.select({ n: count() }).from(assignmentJobs).where(filter);
    return row?.n ?? 0;
  }

  async reclaimStaleJobs(reservationTimeoutSeconds: number): Promise<number> {
    const res = await db.execute(sql`
      UPDATE assignment_jobs SET status = 'pending', locked_at = null, locked_by = null, updated_at = now()
      WHERE status = 'processing' AND locked_at IS NOT NULL
        AND locked_at < now() - make_interval(secs => ${reservationTimeoutSeconds})
      RETURNING id
    `);
    const rows = (res as unknown as { rows: unknown[] }).rows ?? [];
    if (rows.length > 0) {
      metrics.increment("assignment.recovered", rows.length);
      logger.warn("stale_jobs_reclaimed", { count: rows.length, reservationTimeoutSeconds });
    }
    return rows.length;
  }
}

export const assignmentQueue: AssignmentQueue = new PostgresAssignmentQueue();

// Drains due jobs through the pipeline. One reserved batch at a time; each
// job's outcome decides its fate:
//   assigned                      -> complete (done)
//   claim_lost / skipped          -> complete (lead already handled or
//                                    intentionally not assigned; nothing to retry)
//   no_eligible_agent / error     -> retry with backoff, or dead-letter
// Returns counts so the cron backstop can report progress.
export async function processDueJobs(limit = 50): Promise<{ processed: number; assigned: number }> {
  const jobs = await assignmentQueue.reserveDue(limit);
  let assigned = 0;
  for (const job of jobs) {
    try {
      const res = await runPipeline({
        leadId: job.leadId,
        companyId: job.companyId,
        requiredSkillId: job.requiredSkillId,
        excludeAgentId: job.excludeAgentId,
        source: "queue",
        attempt: job.attempts + 1,
      });
      if (res.outcome === "assigned") {
        await assignmentQueue.complete(job.id);
        assigned++;
      } else if (res.outcome === "claim_lost" || res.outcome === "skipped") {
        await assignmentQueue.complete(job.id);
      } else {
        await assignmentQueue.retryOrDeadLetter(job, res.reason);
      }
    } catch (err) {
      await assignmentQueue.retryOrDeadLetter(job, err instanceof Error ? err.message : String(err));
    }
  }
  return { processed: jobs.length, assigned };
}

// Fire-and-forget, single-flight worker kick — the SAME proven pattern as
// kickImport/kickCompanySweep already in this codebase. Drains until the
// queue is empty of DUE work, then stops. Event-driven, never a polling loop.
let workerRunning = false;
export function kickJobWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  (async () => {
    try {
      let batch = await processDueJobs(50);
      let guard = 0;
      // Keep draining while a full batch keeps coming back, bounded so a
      // pathological backlog yields instead of monopolizing the event loop
      // (the cron backstop picks up the remainder).
      while (batch.processed > 0 && guard < 200) {
        batch = await processDueJobs(50);
        guard++;
      }
    } catch (err) {
      logger.error("job_worker_crashed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      workerRunning = false;
    }
  })();
}
