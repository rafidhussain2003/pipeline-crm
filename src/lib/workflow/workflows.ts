// Phase 23 — WorkflowService: the builder's backend. CRUD + duplicate + the
// draft → published → disabled → archived lifecycle + immutable version
// snapshots. A workflow's ACTIONS are stored normalized (workflow_actions);
// create/update replace the whole ordered set (simpler and race-free for an
// author-time operation than diffing).
import { db } from "@/db";
import { workflows, workflowActions, workflowVersions } from "@/db/schema";
import { and, asc, desc, eq, ilike, max, or, sql, type SQL } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { WorkflowError, validateWorkflowName, type WorkflowStatus, type ActionStepInput } from "./types";
import { isRegisteredTrigger, getTrigger } from "./triggers";
import { isRegisteredAction } from "./actions";
import { validateConditionNode } from "./conditions";

export interface WorkflowInput {
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig?: Record<string, unknown> | null;
  conditions?: unknown;
  retryConfig?: { maxRetries?: number; backoffSeconds?: number } | null;
  actions?: ActionStepInput[];
}

function validateRetry(rc: WorkflowInput["retryConfig"]) {
  if (rc == null) return null;
  const maxRetries = Math.max(0, Math.min(10, Math.round(Number(rc.maxRetries ?? 0))));
  const backoffSeconds = Math.max(1, Math.min(3600, Math.round(Number(rc.backoffSeconds ?? 30))));
  return { maxRetries, backoffSeconds };
}

function validateActions(actions: ActionStepInput[] | undefined): ActionStepInput[] {
  const list = actions ?? [];
  return list.map((a, i) => {
    if (!isRegisteredAction(a.actionType)) throw new WorkflowError(`Unknown action "${a.actionType}" (step ${i + 1})`);
    return { actionType: a.actionType, config: a.config ?? {}, continueOnError: !!a.continueOnError };
  });
}

async function replaceActions(companyId: string, workflowId: string, actions: ActionStepInput[]) {
  await db.delete(workflowActions).where(eq(workflowActions.workflowId, workflowId));
  if (actions.length === 0) return;
  await db.insert(workflowActions).values(
    actions.map((a, i) => ({ companyId, workflowId, position: i, actionType: a.actionType, config: (a.config ?? {}) as Record<string, unknown>, continueOnError: !!a.continueOnError })),
  );
}

async function assertWorkflow(companyId: string, id: string) {
  const [row] = await db.select().from(workflows).where(and(eq(workflows.id, id), eq(workflows.companyId, companyId))).limit(1);
  if (!row) throw new WorkflowError("Workflow not found", 404);
  return row;
}

export async function getWorkflowActions(workflowId: string) {
  return db.select().from(workflowActions).where(eq(workflowActions.workflowId, workflowId)).orderBy(asc(workflowActions.position));
}

// A workflow hydrated with its ordered actions + the trigger's display label.
export async function getWorkflow(companyId: string, id: string) {
  const row = await assertWorkflow(companyId, id);
  const actions = await getWorkflowActions(id);
  const trigger = getTrigger(row.triggerType);
  return { ...row, triggerLabel: trigger?.label ?? row.triggerType, actions };
}

export interface ListWorkflowsOpts {
  status?: string;
  triggerType?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listWorkflows(companyId: string, opts: ListWorkflowsOpts = {}) {
  const where: SQL[] = [eq(workflows.companyId, companyId)];
  if (opts.status) where.push(eq(workflows.status, opts.status));
  if (opts.triggerType) where.push(eq(workflows.triggerType, opts.triggerType));
  if (opts.search?.trim()) { const m = or(ilike(workflows.name, `%${opts.search.trim()}%`), ilike(workflows.description, `%${opts.search.trim()}%`)); if (m) where.push(m); }
  const rows = await db
    .select({
      id: workflows.id, name: workflows.name, description: workflows.description, status: workflows.status,
      version: workflows.version, triggerType: workflows.triggerType, executionCount: workflows.executionCount,
      lastExecutedAt: workflows.lastExecutedAt, updatedAt: workflows.updatedAt,
      actionCount: sql<number>`(select count(*) from workflow_actions a where a.workflow_id = ${workflows.id})::int`,
    })
    .from(workflows)
    .where(and(...where))
    .orderBy(desc(workflows.updatedAt))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
  return rows.map((r) => ({ ...r, triggerLabel: getTrigger(r.triggerType)?.label ?? r.triggerType }));
}

export async function createWorkflow(companyId: string, actorUserId: string, input: WorkflowInput) {
  const name = validateWorkflowName(input.name);
  if (!isRegisteredTrigger(input.triggerType)) throw new WorkflowError(`Unknown trigger "${input.triggerType}"`);
  const conditions = validateConditionNode(input.conditions ?? null);
  const actions = validateActions(input.actions);
  const [row] = await db.insert(workflows).values({
    companyId, name, description: input.description?.trim() || null, status: "draft", version: 1,
    triggerType: input.triggerType, triggerConfig: (input.triggerConfig ?? null) as Record<string, unknown> | null,
    conditions: conditions as unknown as Record<string, unknown> | null, retryConfig: validateRetry(input.retryConfig),
    createdBy: actorUserId, updatedBy: actorUserId,
  }).returning();
  await replaceActions(companyId, row.id, actions);
  await recordAudit({ companyId, userId: actorUserId, action: "workflow.created", entityType: "workflow", entityId: row.id, after: { name: row.name, triggerType: row.triggerType } });
  return getWorkflow(companyId, row.id);
}

export async function updateWorkflow(companyId: string, actorUserId: string, id: string, patch: Partial<WorkflowInput>) {
  const existing = await assertWorkflow(companyId, id);
  if (existing.status === "archived") throw new WorkflowError("Archived workflows are read-only — duplicate it to make changes");
  const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actorUserId };
  if (patch.name !== undefined) set.name = validateWorkflowName(patch.name);
  if (patch.description !== undefined) set.description = patch.description?.trim() || null;
  if (patch.triggerType !== undefined) { if (!isRegisteredTrigger(patch.triggerType)) throw new WorkflowError(`Unknown trigger "${patch.triggerType}"`); set.triggerType = patch.triggerType; }
  if (patch.triggerConfig !== undefined) set.triggerConfig = patch.triggerConfig ?? null;
  if (patch.conditions !== undefined) set.conditions = validateConditionNode(patch.conditions ?? null);
  if (patch.retryConfig !== undefined) set.retryConfig = validateRetry(patch.retryConfig);
  await db.update(workflows).set(set).where(eq(workflows.id, id));
  if (patch.actions !== undefined) await replaceActions(companyId, id, validateActions(patch.actions));
  await recordAudit({ companyId, userId: actorUserId, action: "workflow.updated", entityType: "workflow", entityId: id, after: { fields: Object.keys(set).filter((k) => k !== "updatedAt" && k !== "updatedBy") } });
  return getWorkflow(companyId, id);
}

// Publish: snapshot the current definition as an immutable version and make the
// workflow live. Each publish increments the version number (Version History).
export async function publishWorkflow(companyId: string, actorUserId: string, id: string) {
  const wf = await assertWorkflow(companyId, id);
  if (wf.status === "archived") throw new WorkflowError("Cannot publish an archived workflow");
  const actions = await getWorkflowActions(id);
  const [{ v: prevMax } = { v: null }] = await db.select({ v: max(workflowVersions.version) }).from(workflowVersions).where(eq(workflowVersions.workflowId, id));
  const newVersion = (prevMax ?? 0) + 1;
  const snapshot = {
    name: wf.name, description: wf.description, triggerType: wf.triggerType, triggerConfig: wf.triggerConfig,
    conditions: wf.conditions, retryConfig: wf.retryConfig,
    actions: actions.map((a) => ({ position: a.position, actionType: a.actionType, config: a.config, continueOnError: a.continueOnError })),
  };
  await db.insert(workflowVersions).values({ companyId, workflowId: id, version: newVersion, snapshot, createdBy: actorUserId });
  await db.update(workflows).set({ status: "published", version: newVersion, updatedAt: new Date(), updatedBy: actorUserId }).where(eq(workflows.id, id));
  await recordAudit({ companyId, userId: actorUserId, action: "workflow.published", entityType: "workflow", entityId: id, after: { version: newVersion } });
  return getWorkflow(companyId, id);
}

async function setStatus(companyId: string, actorUserId: string, id: string, status: WorkflowStatus, audit: string) {
  await assertWorkflow(companyId, id);
  await db.update(workflows).set({ status, updatedAt: new Date(), updatedBy: actorUserId }).where(eq(workflows.id, id));
  await recordAudit({ companyId, userId: actorUserId, action: audit, entityType: "workflow", entityId: id, after: { status } });
  return getWorkflow(companyId, id);
}

export const disableWorkflow = (companyId: string, actorUserId: string, id: string) => setStatus(companyId, actorUserId, id, "disabled", "workflow.disabled");
export const archiveWorkflow = (companyId: string, actorUserId: string, id: string) => setStatus(companyId, actorUserId, id, "archived", "workflow.archived");

export async function duplicateWorkflow(companyId: string, actorUserId: string, id: string) {
  const src = await assertWorkflow(companyId, id);
  const actions = await getWorkflowActions(id);
  const [row] = await db.insert(workflows).values({
    companyId, name: `Copy of ${src.name}`.slice(0, 160), description: src.description, status: "draft", version: 1,
    triggerType: src.triggerType, triggerConfig: src.triggerConfig, conditions: src.conditions, retryConfig: src.retryConfig,
    createdBy: actorUserId, updatedBy: actorUserId,
  }).returning();
  await replaceActions(companyId, row.id, actions.map((a) => ({ actionType: a.actionType, config: (a.config ?? {}) as Record<string, unknown>, continueOnError: a.continueOnError })));
  await recordAudit({ companyId, userId: actorUserId, action: "workflow.created", entityType: "workflow", entityId: row.id, after: { name: row.name, duplicatedFrom: id } });
  return getWorkflow(companyId, row.id);
}

export async function listVersions(companyId: string, id: string) {
  await assertWorkflow(companyId, id);
  return db.select({ id: workflowVersions.id, version: workflowVersions.version, snapshot: workflowVersions.snapshot, note: workflowVersions.note, createdBy: workflowVersions.createdBy, createdAt: workflowVersions.createdAt })
    .from(workflowVersions).where(eq(workflowVersions.workflowId, id)).orderBy(desc(workflowVersions.version));
}

// Hard delete — only an archived workflow (guards against nuking a live one);
// executions/versions/actions cascade.
export async function deleteWorkflow(companyId: string, actorUserId: string, id: string): Promise<void> {
  const wf = await assertWorkflow(companyId, id);
  if (wf.status !== "archived") throw new WorkflowError("Only archived workflows can be deleted");
  await db.delete(workflows).where(eq(workflows.id, id));
  await recordAudit({ companyId, userId: actorUserId, action: "workflow.deleted", entityType: "workflow", entityId: id, before: { name: wf.name } });
}
