// Phase 23 — the Automation dashboard summary (cheap aggregate queries only —
// no analytics; that's a future phase / report placeholder).
import { db } from "@/db";
import { workflows, workflowExecutions } from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getTrigger } from "./triggers";

export async function workflowDashboard(companyId: string) {
  // Workflow counts by status.
  const statusRows = await db
    .select({ status: workflows.status, n: sql<number>`count(*)::int` })
    .from(workflows).where(eq(workflows.companyId, companyId)).groupBy(workflows.status);
  const byStatus: Record<string, number> = { draft: 0, published: 0, disabled: 0, archived: 0 };
  let totalWorkflows = 0;
  for (const r of statusRows) { byStatus[r.status] = r.n; totalWorkflows += r.n; }

  // Execution counts by status over the last 7 days.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const execRows = await db
    .select({ status: workflowExecutions.status, n: sql<number>`count(*)::int` })
    .from(workflowExecutions).where(and(eq(workflowExecutions.companyId, companyId), gte(workflowExecutions.createdAt, since)))
    .groupBy(workflowExecutions.status);
  const execByStatus: Record<string, number> = {};
  let recentTotal = 0;
  for (const r of execRows) { execByStatus[r.status] = r.n; recentTotal += r.n; }
  const success = execByStatus.success ?? 0;
  const successRate = recentTotal > 0 ? Math.round((success / recentTotal) * 100) : null;

  // Most recent executions.
  const recent = await db
    .select({
      id: workflowExecutions.id, workflowId: workflowExecutions.workflowId, triggerType: workflowExecutions.triggerType,
      status: workflowExecutions.status, durationMs: workflowExecutions.durationMs, createdAt: workflowExecutions.createdAt,
      workflowName: workflows.name,
    })
    .from(workflowExecutions)
    .leftJoin(workflows, eq(workflows.id, workflowExecutions.workflowId))
    .where(eq(workflowExecutions.companyId, companyId))
    .orderBy(desc(workflowExecutions.createdAt))
    .limit(8);

  return {
    totalWorkflows,
    byStatus,
    executions7d: recentTotal,
    execByStatus,
    successRate,
    deadLetter: execByStatus.dead_letter ?? 0,
    recent: recent.map((r) => ({ ...r, triggerLabel: getTrigger(r.triggerType)?.label ?? r.triggerType })),
  };
}
