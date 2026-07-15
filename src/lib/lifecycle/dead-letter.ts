// Dead-letter management (Phase 4). The queue already MOVES a job to
// dead_letter after exhausting retries (see job-queue.ts) and never discards
// it. This exposes that queue: list what's dead-lettered and why, and allow an
// operator (or a future admin UI/API) to retry one or all — reason is always
// preserved, nothing is silently dropped.
import { db } from "@/db";
import { assignmentJobs, leads } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { kickJobWorker } from "@/lib/assignment/job-queue";
import { metrics } from "@/lib/infra/metrics";

export interface DeadLetterEntry {
  jobId: string;
  leadId: string;
  leadName: string | null;
  attempts: number;
  lastError: string | null;
  deadLetteredAt: Date;
}

export async function listDeadLetter(companyId: string, limit = 100): Promise<DeadLetterEntry[]> {
  const rows = await db
    .select({
      jobId: assignmentJobs.id,
      leadId: assignmentJobs.leadId,
      leadName: leads.name,
      attempts: assignmentJobs.attempts,
      lastError: assignmentJobs.lastError,
      updatedAt: assignmentJobs.updatedAt,
    })
    .from(assignmentJobs)
    .leftJoin(leads, eq(leads.id, assignmentJobs.leadId))
    .where(and(eq(assignmentJobs.companyId, companyId), eq(assignmentJobs.status, "dead_letter")))
    .orderBy(desc(assignmentJobs.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    jobId: r.jobId,
    leadId: r.leadId,
    leadName: r.leadName ?? null,
    attempts: r.attempts,
    lastError: r.lastError ?? null,
    deadLetteredAt: r.updatedAt,
  }));
}

export async function deadLetterCount(companyId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assignmentJobs)
    .where(and(eq(assignmentJobs.companyId, companyId), eq(assignmentJobs.status, "dead_letter")));
  return Number(row?.n ?? 0);
}

// Reset a dead-lettered job back to pending (fresh attempt budget) and wake the
// worker. Scoped to the company so one tenant can't touch another's queue.
export async function retryDeadLetter(companyId: string, jobId: string): Promise<boolean> {
  const res = await db
    .update(assignmentJobs)
    .set({ status: "pending", attempts: 0, availableAt: sql`now()`, lockedAt: null, lockedBy: null, lastError: null, updatedAt: new Date() })
    .where(and(eq(assignmentJobs.id, jobId), eq(assignmentJobs.companyId, companyId), eq(assignmentJobs.status, "dead_letter")))
    .returning({ id: assignmentJobs.id });
  if (res.length === 0) return false;
  metrics.increment("assignment.dead_letter_retried");
  kickJobWorker();
  return true;
}

export async function retryAllDeadLetter(companyId: string): Promise<number> {
  const res = await db
    .update(assignmentJobs)
    .set({ status: "pending", attempts: 0, availableAt: sql`now()`, lockedAt: null, lockedBy: null, lastError: null, updatedAt: new Date() })
    .where(and(eq(assignmentJobs.companyId, companyId), eq(assignmentJobs.status, "dead_letter")))
    .returning({ id: assignmentJobs.id });
  if (res.length > 0) {
    metrics.increment("assignment.dead_letter_retried", res.length);
    kickJobWorker();
  }
  return res.length;
}
