// Phase 21 — incentives + deductions. One table, split by `kind`. One-time
// adjustments apply to the run whose period contains effectiveDate and are then
// "consumed" so they can't double-apply; recurring ones apply every run from
// effectiveDate until endDate (or forever). Penalty/loan/advance are deduction
// categories riding the same mechanics (placeholders — no amortization yet).
import { db } from "@/db";
import { payrollAdjustments, users } from "@/db/schema";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { DEDUCTION_CATEGORIES, INCENTIVE_CATEGORIES, isValidDateStr, moneyToCents, PayrollError, type AdjustmentKind, type ResolvedAdjustment } from "./types";

export interface AdjustmentInput {
  userId: string;
  kind: string;
  category: string;
  label: string;
  amount: number; // dollars
  recurring?: boolean;
  effectiveDate: string;
  endDate?: string | null;
  notes?: string | null;
}

export async function createAdjustment(companyId: string, actorUserId: string, input: AdjustmentInput) {
  if (input.kind !== "incentive" && input.kind !== "deduction") throw new PayrollError("kind must be incentive or deduction");
  const validCats: readonly string[] = input.kind === "incentive" ? INCENTIVE_CATEGORIES : DEDUCTION_CATEGORIES;
  if (!validCats.includes(input.category)) throw new PayrollError(`Invalid ${input.kind} category`);
  if (!input.label?.trim()) throw new PayrollError("A label is required");
  const amountCents = moneyToCents(input.amount);
  if (amountCents <= 0) throw new PayrollError("Amount must be greater than zero");
  if (!isValidDateStr(input.effectiveDate)) throw new PayrollError("A valid effective date is required");
  if (input.endDate && !isValidDateStr(input.endDate)) throw new PayrollError("Invalid end date");

  const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.userId), eq(users.companyId, companyId))).limit(1);
  if (!target) throw new PayrollError("Employee not found", 404);

  const [row] = await db
    .insert(payrollAdjustments)
    .values({
      companyId,
      userId: input.userId,
      kind: input.kind,
      category: input.category,
      label: input.label.trim(),
      amountCents,
      recurring: input.recurring ?? false,
      effectiveDate: input.effectiveDate,
      endDate: input.endDate ?? null,
      notes: input.notes?.trim() || null,
      createdBy: actorUserId,
    })
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: input.kind === "incentive" ? "payroll.incentive_created" : "payroll.deduction_created", entityType: "payroll_adjustment", entityId: row.id, after: { userId: input.userId, category: row.category, amountCents, recurring: row.recurring } });
  return row;
}

export async function cancelAdjustment(companyId: string, actorUserId: string, adjustmentId: string) {
  const [row] = await db.select().from(payrollAdjustments).where(and(eq(payrollAdjustments.id, adjustmentId), eq(payrollAdjustments.companyId, companyId))).limit(1);
  if (!row) throw new PayrollError("Adjustment not found", 404);
  if (row.status === "consumed") throw new PayrollError("This adjustment has already been applied to a payroll run");
  await db.update(payrollAdjustments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(payrollAdjustments.id, adjustmentId));
  await recordAudit({ companyId, userId: actorUserId, action: "payroll.adjustment_cancelled", entityType: "payroll_adjustment", entityId: adjustmentId, before: { status: row.status } });
}

export async function listAdjustments(companyId: string, opts: { kind?: AdjustmentKind; userId?: string; status?: string } = {}) {
  const where = [eq(payrollAdjustments.companyId, companyId)];
  if (opts.kind) where.push(eq(payrollAdjustments.kind, opts.kind));
  if (opts.userId) where.push(eq(payrollAdjustments.userId, opts.userId));
  if (opts.status) where.push(eq(payrollAdjustments.status, opts.status));
  return db
    .select({
      id: payrollAdjustments.id,
      userId: payrollAdjustments.userId,
      userName: users.name,
      kind: payrollAdjustments.kind,
      category: payrollAdjustments.category,
      label: payrollAdjustments.label,
      amountCents: payrollAdjustments.amountCents,
      recurring: payrollAdjustments.recurring,
      effectiveDate: payrollAdjustments.effectiveDate,
      endDate: payrollAdjustments.endDate,
      status: payrollAdjustments.status,
      notes: payrollAdjustments.notes,
      createdAt: payrollAdjustments.createdAt,
    })
    .from(payrollAdjustments)
    .innerJoin(users, eq(users.id, payrollAdjustments.userId))
    .where(and(...where))
    .orderBy(desc(payrollAdjustments.createdAt))
    .limit(200);
}

// Which adjustments apply to a given user for a run period. One-time: active,
// effectiveDate within the period, not yet consumed. Recurring: active,
// started on/before the period end, not ended before the period start.
export async function resolveForPeriod(companyId: string, userId: string, periodStart: string, periodEnd: string): Promise<{ resolved: ResolvedAdjustment[]; oneTimeIds: string[] }> {
  const rows = await db
    .select()
    .from(payrollAdjustments)
    .where(
      and(
        eq(payrollAdjustments.companyId, companyId),
        eq(payrollAdjustments.userId, userId),
        eq(payrollAdjustments.status, "active"),
        or(
          // one-time within the period
          and(eq(payrollAdjustments.recurring, false), gte(payrollAdjustments.effectiveDate, periodStart), lte(payrollAdjustments.effectiveDate, periodEnd)),
          // recurring overlapping the period
          and(
            eq(payrollAdjustments.recurring, true),
            lte(payrollAdjustments.effectiveDate, periodEnd),
            or(isNull(payrollAdjustments.endDate), gte(payrollAdjustments.endDate, periodStart)),
          ),
        ),
      ),
    );
  const resolved: ResolvedAdjustment[] = rows.map((r) => ({ id: r.id, kind: r.kind as AdjustmentKind, category: r.category, label: r.label, amountCents: r.amountCents }));
  const oneTimeIds = rows.filter((r) => !r.recurring).map((r) => r.id);
  return { resolved, oneTimeIds };
}
// Consuming one-time adjustments (marking them applied to a run) happens inside
// the run-approval transaction in runs.ts — see approveRun.
