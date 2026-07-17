// Phase 21 — PayrollRunService: the run lifecycle orchestrator.
//   draft → calculated → approved → (locked) → paid
// Calculate reads Attendance (adapter) + adjustments, runs the pure engine, and
// snapshots one immutable payroll_item per employee. Approve posts the Finance
// accrual journal and consumes one-time adjustments; nothing about an approved
// run's items may change. Mark-paid posts the Finance payment journal.
import { db } from "@/db";
import { payrollAdjustments, payrollItems, payrollProfiles, payrollRuns, payrollStructures, users } from "@/db/schema";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { isValidDateStr, PAY_FREQUENCIES, PayrollError, type PayFrequency, type StructureComponent } from "./types";
import { getPayrollSettings, nextRunNumber } from "./settings";
import { getPayrollAttendance } from "./attendance-adapter";
import { resolveForPeriod } from "./adjustments";
import { calculatePayroll } from "./calculation";
import { postAccrual, postPayment } from "./finance-integration";

export async function createRun(companyId: string, actorUserId: string, input: { label: string; frequency: string; periodStart: string; periodEnd: string; payDate: string }) {
  if (!input.label?.trim()) throw new PayrollError("A run label is required");
  if (!PAY_FREQUENCIES.includes(input.frequency as PayFrequency)) throw new PayrollError("Invalid frequency");
  if (!isValidDateStr(input.periodStart) || !isValidDateStr(input.periodEnd) || !isValidDateStr(input.payDate)) throw new PayrollError("Valid period start/end and pay date are required");
  if (input.periodStart > input.periodEnd) throw new PayrollError("Period start must be on or before period end");

  const [row] = await db
    .insert(payrollRuns)
    .values({ companyId, label: input.label.trim(), frequency: input.frequency, periodStart: input.periodStart, periodEnd: input.periodEnd, payDate: input.payDate, createdBy: actorUserId })
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "payroll.run_created", entityType: "payroll_run", entityId: row.id, after: { label: row.label, periodStart: row.periodStart, periodEnd: row.periodEnd } });
  return row;
}

export async function getRun(companyId: string, runId: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).limit(1);
  if (!run) return null;
  const items = await db
    .select({
      id: payrollItems.id,
      userId: payrollItems.userId,
      userName: users.name,
      basicCents: payrollItems.basicCents,
      allowancesCents: payrollItems.allowancesCents,
      incentivesCents: payrollItems.incentivesCents,
      overtimeCents: payrollItems.overtimeCents,
      grossCents: payrollItems.grossCents,
      deductionsCents: payrollItems.deductionsCents,
      leaveAdjustmentCents: payrollItems.leaveAdjustmentCents,
      netCents: payrollItems.netCents,
      overtimeMinutes: payrollItems.overtimeMinutes,
    })
    .from(payrollItems)
    .innerJoin(users, eq(users.id, payrollItems.userId))
    .where(eq(payrollItems.runId, runId))
    .orderBy(asc(users.name));
  return { ...run, items };
}

export async function listRuns(companyId: string, opts: { status?: string; limit?: number; offset?: number } = {}) {
  const where = [eq(payrollRuns.companyId, companyId)];
  if (opts.status) where.push(eq(payrollRuns.status, opts.status));
  return db
    .select()
    .from(payrollRuns)
    .where(and(...where))
    .orderBy(desc(payrollRuns.periodStart), desc(payrollRuns.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}

// CALCULATE — allowed only while draft/calculated (recalculation replaces the
// items). Never after approval.
export async function calculateRun(companyId: string, actorUserId: string, runId: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).limit(1);
  if (!run) throw new PayrollError("Payroll run not found", 404);
  if (run.status !== "draft" && run.status !== "calculated") throw new PayrollError(`A ${run.status} run cannot be recalculated`);

  const settings = await getPayrollSettings(companyId);

  // Active employees with a structure assigned. Frequency must match the run.
  const profiles = await db
    .select({
      userId: payrollProfiles.userId,
      structureId: payrollProfiles.structureId,
      frequency: payrollProfiles.frequency,
      basicCents: payrollStructures.basicCents,
      components: payrollStructures.components,
    })
    .from(payrollProfiles)
    .innerJoin(payrollStructures, eq(payrollStructures.id, payrollProfiles.structureId))
    .where(and(eq(payrollProfiles.companyId, companyId), eq(payrollProfiles.status, "active"), eq(payrollProfiles.frequency, run.frequency)));

  if (profiles.length === 0) throw new PayrollError(`No active employees on a "${run.frequency}" salary structure to pay`);

  const computed: { userId: string; structureId: string; calc: ReturnType<typeof calculatePayroll>; attendance: Awaited<ReturnType<typeof getPayrollAttendance>>; oneTimeIds: string[] }[] = [];
  for (const p of profiles) {
    const attendance = await getPayrollAttendance(companyId, p.userId, run.periodStart, run.periodEnd, settings.standardWorkdayMinutes);
    const { resolved, oneTimeIds } = await resolveForPeriod(companyId, p.userId, run.periodStart, run.periodEnd);
    const calc = calculatePayroll(
      { basicCents: p.basicCents, frequency: run.frequency, components: (p.components as StructureComponent[]) ?? [] },
      attendance,
      resolved,
      { overtimeMultiplier: settings.overtimeMultiplier, standardWorkdayMinutes: settings.standardWorkdayMinutes, standardWorkdaysPerMonth: settings.standardWorkdaysPerMonth },
    );
    computed.push({ userId: p.userId, structureId: p.structureId!, calc, attendance, oneTimeIds });
  }

  const totalGross = computed.reduce((s, c) => s + c.calc.grossCents, 0);
  const totalNet = computed.reduce((s, c) => s + c.calc.netCents, 0);
  const totalDeductions = computed.reduce((s, c) => s + c.calc.deductionsCents + c.calc.leaveAdjustmentCents, 0);

  await db.transaction(async (tx) => {
    // Replace prior items (recalculation).
    await tx.delete(payrollItems).where(eq(payrollItems.runId, runId));
    await tx.insert(payrollItems).values(
      computed.map((c) => ({
        runId,
        companyId,
        userId: c.userId,
        structureId: c.structureId,
        basicCents: c.calc.basicCents,
        allowancesCents: c.calc.allowancesCents,
        incentivesCents: c.calc.incentivesCents,
        overtimeCents: c.calc.overtimeCents,
        grossCents: c.calc.grossCents,
        deductionsCents: c.calc.deductionsCents,
        leaveAdjustmentCents: c.calc.leaveAdjustmentCents,
        taxCents: c.calc.taxCents,
        netCents: c.calc.netCents,
        overtimeMinutes: c.calc.overtimeMinutes,
        attendance: c.attendance,
        breakdown: c.calc.breakdown,
      })),
    );
    await tx
      .update(payrollRuns)
      .set({ status: "calculated", totalGrossCents: totalGross, totalNetCents: totalNet, totalDeductionsCents: totalDeductions, employeeCount: computed.length, calculatedAt: new Date(), updatedAt: new Date() })
      .where(eq(payrollRuns.id, runId));
  });

  await recordAudit({ companyId, userId: actorUserId, action: "payroll.run_calculated", entityType: "payroll_run", entityId: runId, after: { employees: computed.length, totalGrossCents: totalGross, totalNetCents: totalNet } });
  return getRun(companyId, runId);
}

// APPROVE — from calculated only. Posts the Finance accrual journal, consumes
// one-time adjustments, and freezes the run.
export async function approveRun(companyId: string, actorUserId: string, runId: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).limit(1);
  if (!run) throw new PayrollError("Payroll run not found", 404);
  if (run.status !== "calculated") throw new PayrollError(`Only a calculated run can be approved (this one is ${run.status})`);
  if (run.employeeCount === 0) throw new PayrollError("There is nothing to approve");

  const settings = await getPayrollSettings(companyId);
  // Only true deductions become a liability the company owes onward; the
  // leave/absence adjustment is never earned so it isn't a payable. The run
  // total lumped deductions + leaveAdj together, so re-derive the deductions-
  // only figure straight from the immutable items.
  const [sums] = await db
    .select({ dedn: sql<number>`coalesce(sum(${payrollItems.deductionsCents}),0)::bigint`, net: sql<number>`coalesce(sum(${payrollItems.netCents}),0)::bigint` })
    .from(payrollItems)
    .where(eq(payrollItems.runId, runId));
  const totalDeductionsWithheld = Number(sums.dedn);
  const totalNet = Number(sums.net);

  // Finance accrual — via JournalService only.
  const accrualJournalId = await postAccrual(
    companyId,
    actorUserId,
    { runId, runNumber: null, label: run.label, payDate: run.payDate, totalNetCents: totalNet, totalWithheldCents: totalDeductionsWithheld },
    { expense: settings.salaryExpenseAccountCode, payable: settings.salaryPayableAccountCode, withholdings: "2000", payment: settings.defaultPaymentAccountCode },
  );

  const runNumber = await nextRunNumber(companyId);
  const oneTimeIds = (await db.select({ id: payrollAdjustments.id }).from(payrollAdjustments).where(and(eq(payrollAdjustments.companyId, companyId), eq(payrollAdjustments.status, "active"), eq(payrollAdjustments.recurring, false), gte(payrollAdjustments.effectiveDate, run.periodStart), lte(payrollAdjustments.effectiveDate, run.periodEnd)))).map((r) => r.id);

  await db.transaction(async (tx) => {
    // Consume one-time adjustments so they never double-apply to a later run
    // (recurring ones stay active).
    if (oneTimeIds.length > 0) {
      await tx.update(payrollAdjustments).set({ status: "consumed", appliedRunId: runId, updatedAt: new Date() }).where(inArray(payrollAdjustments.id, oneTimeIds));
    }
    await tx.update(payrollRuns).set({ status: "approved", runNumber, accrualJournalId, approvedBy: actorUserId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(payrollRuns.id, runId));
  });

  await recordAudit({ companyId, userId: actorUserId, action: "payroll.run_approved", entityType: "payroll_run", entityId: runId, after: { runNumber, accrualJournalId, totalNetCents: totalNet, withheldCents: totalDeductionsWithheld } });
  return getRun(companyId, runId);
}

export async function lockRun(companyId: string, actorUserId: string, runId: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).limit(1);
  if (!run) throw new PayrollError("Payroll run not found", 404);
  if (run.status !== "approved") throw new PayrollError(`Only an approved run can be locked (this one is ${run.status})`);
  await db.update(payrollRuns).set({ status: "locked", lockedAt: new Date(), updatedAt: new Date() }).where(eq(payrollRuns.id, runId));
  await recordAudit({ companyId, userId: actorUserId, action: "payroll.run_locked", entityType: "payroll_run", entityId: runId });
  return getRun(companyId, runId);
}

// MARK PAID — from approved or locked. Posts the Finance payment journal.
export async function markPaid(companyId: string, actorUserId: string, runId: string, paymentAccountCode?: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).limit(1);
  if (!run) throw new PayrollError("Payroll run not found", 404);
  if (run.status !== "approved" && run.status !== "locked") throw new PayrollError(`Only an approved or locked run can be marked paid (this one is ${run.status})`);

  const settings = await getPayrollSettings(companyId);
  const paymentCode = paymentAccountCode || settings.defaultPaymentAccountCode;

  const paymentJournalId = await postPayment(
    companyId,
    actorUserId,
    { runId, runNumber: run.runNumber, label: run.label, payDate: run.payDate, totalNetCents: run.totalNetCents },
    { payable: settings.salaryPayableAccountCode, payment: paymentCode },
  );

  await db.update(payrollRuns).set({ status: "paid", paymentJournalId, paymentAccountCode: paymentCode, paidBy: actorUserId, paidAt: new Date(), updatedAt: new Date() }).where(eq(payrollRuns.id, runId));
  await recordAudit({ companyId, userId: actorUserId, action: "payroll.run_paid", entityType: "payroll_run", entityId: runId, after: { paymentJournalId, paymentAccountCode: paymentCode, totalNetCents: run.totalNetCents } });
  return getRun(companyId, runId);
}

// Only a draft run can be discarded.
export async function deleteRun(companyId: string, actorUserId: string, runId: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).limit(1);
  if (!run) throw new PayrollError("Payroll run not found", 404);
  if (run.status !== "draft" && run.status !== "calculated") throw new PayrollError("Only a draft or calculated run can be deleted");
  await db.delete(payrollRuns).where(eq(payrollRuns.id, runId)); // items cascade
  await recordAudit({ companyId, userId: actorUserId, action: "payroll.run_deleted", entityType: "payroll_run", entityId: runId, before: { label: run.label, status: run.status } });
}

// SALARY REGISTER — searchable across runs (period / employee / status / net).
export async function salaryRegister(companyId: string, opts: { search?: string; status?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) {
  const where: SQL[] = [eq(payrollItems.companyId, companyId)];
  if (opts.status) where.push(eq(payrollRuns.status, opts.status));
  if (opts.from) where.push(gte(payrollRuns.periodStart, opts.from));
  if (opts.to) where.push(lte(payrollRuns.periodEnd, opts.to));
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    const m = or(ilike(users.name, q), ilike(users.email, q), ilike(payrollRuns.label, q));
    if (m) where.push(m);
  }
  return db
    .select({
      itemId: payrollItems.id,
      runId: payrollRuns.id,
      runLabel: payrollRuns.label,
      periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd,
      status: payrollRuns.status,
      userId: payrollItems.userId,
      userName: users.name,
      department: sql<string | null>`null`, // placeholder — no department model yet
      grossCents: payrollItems.grossCents,
      deductionsCents: payrollItems.deductionsCents,
      netCents: payrollItems.netCents,
    })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .innerJoin(users, eq(users.id, payrollItems.userId))
    .where(and(...where))
    .orderBy(desc(payrollRuns.periodStart), asc(users.name))
    .limit(Math.min(opts.limit ?? 100, 500))
    .offset(Math.max(opts.offset ?? 0, 0));
}
