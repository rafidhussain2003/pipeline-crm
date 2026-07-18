// Phase 23 — HistoryService: read side of the execution trail. The trail itself
// (workflow_executions + workflow_execution_logs) IS the execution audit — it is
// the purpose-built, indexed, millions-of-rows store, kept out of the shared
// auditLog (which records definition changes + manual triggers).
import { db } from "@/db";
import { workflowExecutions, workflowExecutionLogs, workflows } from "@/db/schema";
import { and, desc, eq, asc, type SQL } from "drizzle-orm";
import { WorkflowError } from "./types";

export interface ListExecutionsOpts {
  workflowId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listExecutions(companyId: string, opts: ListExecutionsOpts = {}) {
  const where: SQL[] = [eq(workflowExecutions.companyId, companyId)];
  if (opts.workflowId) where.push(eq(workflowExecutions.workflowId, opts.workflowId));
  if (opts.status) where.push(eq(workflowExecutions.status, opts.status));
  return db
    .select({
      id: workflowExecutions.id, workflowId: workflowExecutions.workflowId, workflowName: workflows.name,
      triggerType: workflowExecutions.triggerType, triggerSource: workflowExecutions.triggerSource,
      status: workflowExecutions.status, attempts: workflowExecutions.attempts, durationMs: workflowExecutions.durationMs,
      startedAt: workflowExecutions.startedAt, finishedAt: workflowExecutions.finishedAt, createdAt: workflowExecutions.createdAt,
    })
    .from(workflowExecutions)
    .leftJoin(workflows, eq(workflows.id, workflowExecutions.workflowId))
    .where(and(...where))
    .orderBy(desc(workflowExecutions.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}

export async function getExecution(companyId: string, id: string) {
  const [exec] = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.id, id), eq(workflowExecutions.companyId, companyId))).limit(1);
  if (!exec) throw new WorkflowError("Execution not found", 404);
  const logs = await db.select().from(workflowExecutionLogs).where(eq(workflowExecutionLogs.executionId, id)).orderBy(asc(workflowExecutionLogs.position));
  const [wf] = await db.select({ name: workflows.name }).from(workflows).where(eq(workflows.id, exec.workflowId)).limit(1);
  return { ...exec, workflowName: wf?.name ?? null, logs };
}
