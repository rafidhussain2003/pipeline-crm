// Phase 21 — PayslipService. A payslip is a VIEW over the immutable payroll_item
// snapshot joined with the run, the employee, and the company header — no
// recomputation. The shape is print/PDF-ready (a future PDF phase renders this
// same object), which is why company info + attendance + the full component
// breakdown are all included.
import { db } from "@/db";
import { companies, payrollItems, payrollRuns, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { PayrollError } from "./types";

// A single payslip. `requesterId` is enforced by the caller when the viewer may
// only see their own (employees) — passed as `restrictToUserId`.
export async function getPayslip(companyId: string, itemId: string, restrictToUserId?: string) {
  const [row] = await db
    .select({
      item: payrollItems,
      run: payrollRuns,
      userName: users.name,
      userEmail: users.email,
    })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .innerJoin(users, eq(users.id, payrollItems.userId))
    .where(and(eq(payrollItems.id, itemId), eq(payrollItems.companyId, companyId)))
    .limit(1);
  if (!row) throw new PayrollError("Payslip not found", 404);
  if (restrictToUserId && row.item.userId !== restrictToUserId) throw new PayrollError("You can only view your own payslips", 403);

  const [company] = await db
    .select({ name: companies.name, address: companies.address, supportEmail: companies.supportEmail, businessPhone: companies.businessPhone })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  return {
    id: row.item.id,
    runId: row.run.id,
    runLabel: row.run.label,
    runStatus: row.run.status,
    // A payslip is only "issued" once its run is approved+.
    issued: row.run.status === "approved" || row.run.status === "locked" || row.run.status === "paid",
    period: { start: row.run.periodStart, end: row.run.periodEnd, payDate: row.run.payDate },
    employee: { userId: row.item.userId, name: row.userName, email: row.userEmail },
    company: company ?? null,
    amounts: {
      basicCents: row.item.basicCents,
      allowancesCents: row.item.allowancesCents,
      incentivesCents: row.item.incentivesCents,
      overtimeCents: row.item.overtimeCents,
      grossCents: row.item.grossCents,
      deductionsCents: row.item.deductionsCents,
      leaveAdjustmentCents: row.item.leaveAdjustmentCents,
      taxCents: row.item.taxCents,
      netCents: row.item.netCents,
    },
    attendance: row.item.attendance,
    breakdown: row.item.breakdown,
    overtimeMinutes: row.item.overtimeMinutes,
  };
}

// An employee's own payslips (issued runs only), newest first.
export async function listPayslipsForUser(companyId: string, userId: string, opts: { limit?: number } = {}) {
  return db
    .select({
      itemId: payrollItems.id,
      runId: payrollRuns.id,
      runLabel: payrollRuns.label,
      periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd,
      payDate: payrollRuns.payDate,
      status: payrollRuns.status,
      grossCents: payrollItems.grossCents,
      netCents: payrollItems.netCents,
    })
    .from(payrollItems)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.runId))
    .where(and(eq(payrollItems.companyId, companyId), eq(payrollItems.userId, userId)))
    .orderBy(desc(payrollRuns.periodStart))
    .limit(Math.min(opts.limit ?? 50, 200));
}
