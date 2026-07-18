// Phase 23 — per-company workflow module settings + idempotent bootstrap. Holds
// the DEFAULT retry policy a workflow inherits when it declares none.
import { db } from "@/db";
import { workflowSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

export async function ensureWorkflowSetup(companyId: string): Promise<void> {
  await db.insert(workflowSettings).values({ companyId }).onConflictDoNothing();
}

export async function getWorkflowSettings(companyId: string) {
  await ensureWorkflowSetup(companyId);
  const [row] = await db.select().from(workflowSettings).where(eq(workflowSettings.companyId, companyId)).limit(1);
  return row!;
}

export async function updateWorkflowSettings(
  companyId: string,
  patch: { defaultMaxRetries?: number; defaultBackoffSeconds?: number; executionRetentionDays?: number },
) {
  await ensureWorkflowSetup(companyId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.defaultMaxRetries !== undefined) set.defaultMaxRetries = clamp(Number(patch.defaultMaxRetries), 0, 10);
  if (patch.defaultBackoffSeconds !== undefined) set.defaultBackoffSeconds = clamp(Number(patch.defaultBackoffSeconds), 1, 3600);
  if (patch.executionRetentionDays !== undefined) set.executionRetentionDays = clamp(Number(patch.executionRetentionDays), 1, 3650);
  const [row] = await db.update(workflowSettings).set(set).where(eq(workflowSettings.companyId, companyId)).returning();
  return row;
}
