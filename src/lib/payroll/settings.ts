// Phase 21 — payroll settings: per-company config + document numbering. Seeded
// idempotently on first access (same pattern as finance/attendance setup).
import { db } from "@/db";
import { payrollSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { PayrollError } from "./types";

export async function ensurePayrollSetup(companyId: string): Promise<void> {
  await db.insert(payrollSettings).values({ companyId }).onConflictDoNothing();
}

export async function getPayrollSettings(companyId: string) {
  await ensurePayrollSetup(companyId);
  const [row] = await db.select().from(payrollSettings).where(eq(payrollSettings.companyId, companyId)).limit(1);
  return row!;
}

export async function updatePayrollSettings(
  companyId: string,
  patch: Partial<{
    defaultFrequency: string;
    overtimeMultiplier: number;
    standardWorkdayMinutes: number;
    standardWorkdaysPerMonth: number;
    payDayOfMonth: number;
    salaryExpenseAccountCode: string;
    salaryPayableAccountCode: string;
    defaultPaymentAccountCode: string;
  }>,
) {
  await ensurePayrollSetup(companyId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.defaultFrequency !== undefined) {
    if (!["monthly", "weekly", "biweekly", "hourly"].includes(patch.defaultFrequency)) throw new PayrollError("Invalid frequency");
    set.defaultFrequency = patch.defaultFrequency;
  }
  if (patch.overtimeMultiplier !== undefined) {
    if (!(patch.overtimeMultiplier >= 1 && patch.overtimeMultiplier <= 5)) throw new PayrollError("Overtime multiplier must be between 1 and 5");
    set.overtimeMultiplier = patch.overtimeMultiplier;
  }
  if (patch.standardWorkdayMinutes !== undefined) {
    if (!(patch.standardWorkdayMinutes >= 60 && patch.standardWorkdayMinutes <= 1440)) throw new PayrollError("Standard workday must be 60–1440 minutes");
    set.standardWorkdayMinutes = Math.round(patch.standardWorkdayMinutes);
  }
  if (patch.standardWorkdaysPerMonth !== undefined) {
    if (!(patch.standardWorkdaysPerMonth >= 1 && patch.standardWorkdaysPerMonth <= 31)) throw new PayrollError("Standard workdays per month must be 1–31");
    set.standardWorkdaysPerMonth = Math.round(patch.standardWorkdaysPerMonth);
  }
  if (patch.payDayOfMonth !== undefined) {
    if (!(patch.payDayOfMonth >= 1 && patch.payDayOfMonth <= 28)) throw new PayrollError("Pay day must be 1–28");
    set.payDayOfMonth = Math.round(patch.payDayOfMonth);
  }
  for (const k of ["salaryExpenseAccountCode", "salaryPayableAccountCode", "defaultPaymentAccountCode"] as const) {
    if (patch[k] !== undefined) {
      if (!/^[0-9A-Za-z.\-]{1,20}$/.test(patch[k]!)) throw new PayrollError("Invalid account code");
      set[k] = patch[k];
    }
  }
  const [row] = await db.update(payrollSettings).set(set).where(eq(payrollSettings.companyId, companyId)).returning();
  return row;
}

// Atomic per-company sequential run number (same UPDATE…RETURNING pattern as
// finance journal numbering).
export async function nextRunNumber(companyId: string): Promise<number> {
  const rows = await db
    .update(payrollSettings)
    .set({ nextRunNumber: sql`${payrollSettings.nextRunNumber} + 1`, updatedAt: new Date() })
    .where(eq(payrollSettings.companyId, companyId))
    .returning({ n: payrollSettings.nextRunNumber });
  if (rows.length === 0) {
    await ensurePayrollSetup(companyId);
    return nextRunNumber(companyId);
  }
  return rows[0].n - 1;
}
