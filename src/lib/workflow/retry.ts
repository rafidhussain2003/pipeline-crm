// Phase 23 — the RetryEngine. A sweep that re-runs every execution whose
// scheduled retry is due. Because a failed-with-retries execution is always
// left as status='retrying' with nextRetryAt set, "due work" is exactly
// `status='retrying' AND next_retry_at<=now` — a single index scan
// (workflow_executions_retry_idx). Scoped to one company for the module's
// retry endpoint, or unscoped for the cron backstop.
import { db } from "@/db";
import { workflowExecutions } from "@/db/schema";
import { and, eq, lte } from "drizzle-orm";
import { runExecution } from "./engine";

export async function runRetrySweep(companyId?: string, limit = 100): Promise<{ processed: number; results: { id: string; status: string }[] }> {
  const now = new Date();
  const base = and(eq(workflowExecutions.status, "retrying"), lte(workflowExecutions.nextRetryAt, now));
  const where = companyId ? and(base, eq(workflowExecutions.companyId, companyId)) : base;
  const due = await db.select({ id: workflowExecutions.id }).from(workflowExecutions).where(where).limit(limit);
  const results: { id: string; status: string }[] = [];
  for (const row of due) {
    const r = await runExecution(row.id);
    if (r) results.push({ id: row.id, status: r.status });
  }
  return { processed: due.length, results };
}

// The dead-letter queue view (a placeholder surface this phase): executions that
// exhausted their retries and need human attention.
export async function listDeadLetter(companyId: string, limit = 50) {
  return db.select({
    id: workflowExecutions.id, workflowId: workflowExecutions.workflowId, triggerType: workflowExecutions.triggerType,
    attempts: workflowExecutions.attempts, error: workflowExecutions.error, finishedAt: workflowExecutions.finishedAt,
  }).from(workflowExecutions).where(and(eq(workflowExecutions.companyId, companyId), eq(workflowExecutions.status, "dead_letter"))).limit(limit);
}
