// Phase 23 — the ExecutionEngine. Runs one workflow against a trigger payload:
// build context → evaluate conditions → run actions in order (logging each) →
// finalize with success / skipped / retry / dead-letter. Retries re-run the
// SAME execution row (so "Retry Count" and the final status live on one record);
// each attempt re-writes that run's step logs.
//
// Status invariant: `retrying` always means "a retry is scheduled" (nextRetryAt
// set) and `dead_letter` means "retries exhausted" — so the retry sweeper is a
// simple `status='retrying' AND nextRetryAt<=now` scan on the retry index.
import { db } from "@/db";
import { workflows, workflowExecutions, workflowExecutionLogs } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { featureService } from "@/lib/features";
import { recordAudit } from "@/lib/audit";
import { WORKFLOW_FEATURE } from "./guard";
import { getWorkflowActions } from "./workflows";
import { getAction } from "./actions";
import { evaluate } from "./conditions";
import { resolveConfig, loadUserVariables } from "./variables";
import { getWorkflowSettings } from "./settings";
import { WorkflowError, type ConditionNode, type TriggerSource } from "./types";

type WorkflowRow = typeof workflows.$inferSelect;

export interface RunResult {
  executionId: string;
  status: "success" | "skipped" | "retrying" | "dead_letter";
  attempt: number;
  nextRetryAt?: Date | null;
}

// Create the execution record (attempt 0 — runExecution does attempt 1+).
async function startExecution(companyId: string, wf: WorkflowRow, input: unknown, source: TriggerSource, triggeredBy: string | null): Promise<string> {
  const settings = await getWorkflowSettings(companyId);
  const rc = (wf.retryConfig ?? null) as { maxRetries?: number } | null;
  const maxRetries = rc?.maxRetries ?? settings.defaultMaxRetries;
  const [row] = await db.insert(workflowExecutions).values({
    companyId, workflowId: wf.id, workflowVersion: wf.version, triggerType: wf.triggerType,
    triggerSource: source, status: "pending", input: (input ?? {}) as Record<string, unknown>, attempts: 0, maxRetries,
    triggeredBy,
  }).returning({ id: workflowExecutions.id });
  return row.id;
}

async function bumpWorkflow(workflowId: string, attempt: number, when: Date) {
  // executionCount counts executions (first attempt only); lastExecutedAt tracks
  // every attempt's finish.
  if (attempt === 1) {
    await db.update(workflows).set({ executionCount: sql`${workflows.executionCount} + 1`, lastExecutedAt: when }).where(eq(workflows.id, workflowId));
  } else {
    await db.update(workflows).set({ lastExecutedAt: when }).where(eq(workflows.id, workflowId));
  }
}

// Run (or re-run) a single execution row through its workflow. Idempotent per
// attempt; safe to call from the initial trigger and from the retry sweep.
export async function runExecution(executionId: string): Promise<RunResult | null> {
  const [exec] = await db.select().from(workflowExecutions).where(eq(workflowExecutions.id, executionId)).limit(1);
  if (!exec) return null;
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, exec.workflowId)).limit(1);
  const attempt = exec.attempts + 1;
  const startedAt = exec.startedAt ?? new Date();

  if (!wf) {
    await db.update(workflowExecutions).set({ status: "dead_letter", attempts: attempt, error: "Workflow no longer exists", finishedAt: new Date(), nextRetryAt: null }).where(eq(workflowExecutions.id, executionId));
    return { executionId, status: "dead_letter", attempt };
  }

  await db.update(workflowExecutions).set({ status: "running", attempts: attempt, startedAt }).where(eq(workflowExecutions.id, executionId));
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.executionId, executionId)); // fresh logs for this attempt

  const userVars = await loadUserVariables(exec.companyId, wf.id);
  const input = (exec.input ?? {}) as Record<string, unknown>;
  const context = {
    ...input,
    workflow: userVars.workflow,
    global: userVars.global,
    execution: { id: exec.id, workflowId: wf.id, workflowVersion: exec.workflowVersion, attempt, startedAt: startedAt.toISOString() },
    trigger: { type: exec.triggerType, source: exec.triggerSource },
  };

  // ── Conditions ─────────────────────────────────────────────────────────────
  const matched = evaluate(context, (wf.conditions ?? null) as ConditionNode | null);
  if (!matched) {
    const durationMs = Date.now() - startedAt.getTime();
    await db.update(workflowExecutions).set({ status: "skipped", durationMs, finishedAt: new Date(), conditionResult: { matched: false } }).where(eq(workflowExecutions.id, executionId));
    await bumpWorkflow(wf.id, attempt, new Date());
    return { executionId, status: "skipped", attempt };
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const actions = await getWorkflowActions(wf.id);
  let failed = false;
  let errorMsg: string | undefined;
  for (const a of actions) {
    const resolved = resolveConfig((a.config ?? {}) as Record<string, unknown>, context);
    const t0 = Date.now();
    try {
      const def = getAction(a.actionType);
      if (!def) throw new Error(`Unknown action "${a.actionType}"`);
      const res = await def.run({ companyId: exec.companyId, actorUserId: exec.triggeredBy ?? null, execution: { id: exec.id, workflowId: wf.id, workflowVersion: exec.workflowVersion }, context }, resolved);
      if (!res.ok) throw new Error(res.message ?? "Action returned failure");
      await db.insert(workflowExecutionLogs).values({ executionId, position: a.position, actionType: a.actionType, status: "success", input: resolved, output: (res.output ?? null) as Record<string, unknown> | null, message: res.message ?? null, durationMs: Date.now() - t0 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.insert(workflowExecutionLogs).values({ executionId, position: a.position, actionType: a.actionType, status: "failed", input: resolved, message: msg, durationMs: Date.now() - t0 });
      if (a.continueOnError) continue;
      failed = true; errorMsg = msg; break;
    }
  }

  const durationMs = Date.now() - startedAt.getTime();
  if (!failed) {
    await db.update(workflowExecutions).set({ status: "success", durationMs, finishedAt: new Date(), error: null, conditionResult: { matched: true } }).where(eq(workflowExecutions.id, executionId));
    await bumpWorkflow(wf.id, attempt, new Date());
    return { executionId, status: "success", attempt };
  }

  // Failure: schedule a retry (exponential backoff) or dead-letter if exhausted.
  if (attempt <= exec.maxRetries) {
    const rc = (wf.retryConfig ?? null) as { backoffSeconds?: number } | null;
    const backoff = rc?.backoffSeconds ?? 30;
    const delayMs = backoff * Math.pow(2, attempt - 1) * 1000;
    const nextRetryAt = new Date(Date.now() + delayMs);
    await db.update(workflowExecutions).set({ status: "retrying", error: errorMsg, durationMs, nextRetryAt, conditionResult: { matched: true } }).where(eq(workflowExecutions.id, executionId));
    await bumpWorkflow(wf.id, attempt, new Date());
    return { executionId, status: "retrying", attempt, nextRetryAt };
  }
  await db.update(workflowExecutions).set({ status: "dead_letter", error: errorMsg, durationMs, finishedAt: new Date(), nextRetryAt: null, conditionResult: { matched: true } }).where(eq(workflowExecutions.id, executionId));
  await bumpWorkflow(wf.id, attempt, new Date());
  return { executionId, status: "dead_letter", attempt };
}

// ── THE integration seam every module calls ─────────────────────────────────
// A future module makes its events automatable with a single call:
//   await emitWorkflowTrigger(companyId, "lead.created", { lead });
// It resolves published workflows for that (company, trigger), respects the
// feature gate, and runs each. No engine change is ever needed for a new caller.
export async function emitWorkflowTrigger(
  companyId: string,
  triggerType: string,
  input: unknown,
  opts: { triggeredBy?: string | null; source?: TriggerSource } = {},
): Promise<{ ran: number; results: RunResult[] }> {
  if (!(await featureService.isEnabled(companyId, WORKFLOW_FEATURE))) return { ran: 0, results: [] };
  const wfs = await db.select().from(workflows).where(and(eq(workflows.companyId, companyId), eq(workflows.triggerType, triggerType), eq(workflows.status, "published")));
  const results: RunResult[] = [];
  for (const wf of wfs) {
    const execId = await startExecution(companyId, wf, input, opts.source ?? "event", opts.triggeredBy ?? null);
    const r = await runExecution(execId);
    if (r) results.push(r);
  }
  return { ran: wfs.length, results };
}

// Manual trigger from the workflow screen / API. Allowed for any non-archived
// workflow (so authors can test a draft before publishing).
export async function triggerWorkflowManually(companyId: string, actorUserId: string, workflowId: string, input: unknown): Promise<RunResult> {
  const [wf] = await db.select().from(workflows).where(and(eq(workflows.id, workflowId), eq(workflows.companyId, companyId))).limit(1);
  if (!wf) throw new WorkflowError("Workflow not found", 404);
  if (wf.status === "archived") throw new WorkflowError("Cannot run an archived workflow");
  await recordAudit({ companyId, userId: actorUserId, action: "workflow.manual_trigger", entityType: "workflow", entityId: workflowId, after: { name: wf.name } });
  const execId = await startExecution(companyId, wf, input, "manual", actorUserId);
  const r = await runExecution(execId);
  return r!;
}
