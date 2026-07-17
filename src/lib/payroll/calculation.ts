// Phase 21 — CalculationService: the pure, deterministic payroll math. No I/O,
// no DB — given a structure snapshot, the attendance figures, the resolved
// adjustments, and the settings, it returns every line of the payslip. Pure so
// it is unit-testable and reusable, and so a future tax phase slots a hook into
// ONE place (taxCents) without touching callers.
//
// All money is integer cents. The period's EXPECTED WORKING DAYS (from the
// Attendance calendar) is the proration divisor, which makes the engine
// frequency-agnostic: a monthly salary over a 22-working-day month prorates on
// /22; a weekly salary over a 5-day week prorates on /5.
import type { PayFrequency, PayrollAttendance, ResolvedAdjustment, StructureComponent } from "./types";

export interface CalcStructure {
  basicCents: number;
  frequency: PayFrequency | string;
  components: StructureComponent[];
}

export interface CalcSettings {
  overtimeMultiplier: number;
  standardWorkdayMinutes: number;
  standardWorkdaysPerMonth: number;
}

export interface BreakdownLine {
  key: string;
  label: string;
  amountCents: number;
}

export interface PayrollCalculation {
  basicCents: number;
  allowancesCents: number;
  fixedIncentivesCents: number;
  variableIncentivesCents: number;
  incentivesCents: number; // fixed + variable
  overtimeCents: number;
  overtimeMinutes: number;
  overtimeRateCentsPerHour: number;
  grossCents: number; // basic + allowances + incentives + overtime (earnings)
  structureDeductionsCents: number;
  adjustmentDeductionsCents: number;
  deductionsCents: number; // structure + adjustment deductions
  leaveAdjustmentCents: number; // unpaid-leave + absence proration (separate from deductions)
  employerContributionsCents: number; // informational — employer cost, not employee earnings
  taxCents: number; // placeholder — always 0 this phase
  netCents: number;
  breakdown: { earnings: BreakdownLine[]; deductions: BreakdownLine[]; employerContributions: BreakdownLine[] };
}

export function calculatePayroll(
  structure: CalcStructure,
  attendance: PayrollAttendance,
  adjustments: ResolvedAdjustment[],
  settings: CalcSettings,
): PayrollCalculation {
  const basicCents = Math.max(0, Math.round(structure.basicCents));
  const components = Array.isArray(structure.components) ? structure.components : [];

  const earnings: BreakdownLine[] = [{ key: "basic", label: "Basic Salary", amountCents: basicCents }];
  const deductions: BreakdownLine[] = [];
  const employerContributions: BreakdownLine[] = [];

  // Structure components.
  let allowancesCents = 0;
  let fixedIncentivesCents = 0;
  let structureDeductionsCents = 0;
  let employerContributionsCents = 0;
  for (const c of components) {
    const amt = Math.round(c.amountCents || 0);
    if (amt <= 0) continue;
    switch (c.type) {
      case "allowance":
      case "hra": // placeholder allowance
        allowancesCents += amt;
        earnings.push({ key: c.key, label: c.label, amountCents: amt });
        break;
      case "fixed_incentive":
        fixedIncentivesCents += amt;
        earnings.push({ key: c.key, label: c.label, amountCents: amt });
        break;
      case "custom":
        // Custom components are treated as taxable earnings (allowance-like).
        allowancesCents += amt;
        earnings.push({ key: c.key, label: c.label, amountCents: amt });
        break;
      case "deduction":
        structureDeductionsCents += amt;
        deductions.push({ key: c.key, label: c.label, amountCents: amt });
        break;
      case "employer_contribution": // placeholder — informational cost, not paid to employee
        employerContributionsCents += amt;
        employerContributions.push({ key: c.key, label: c.label, amountCents: amt });
        break;
    }
  }

  // Adjustments (incentives add to earnings, deductions subtract).
  let variableIncentivesCents = 0;
  let adjustmentDeductionsCents = 0;
  for (const a of adjustments) {
    const amt = Math.max(0, Math.round(a.amountCents));
    if (amt === 0) continue;
    if (a.kind === "incentive") {
      variableIncentivesCents += amt;
      earnings.push({ key: `incentive:${a.id ?? a.label}`, label: a.label, amountCents: amt });
    } else {
      adjustmentDeductionsCents += amt;
      deductions.push({ key: `deduction:${a.id ?? a.label}`, label: a.label, amountCents: amt });
    }
  }

  // Overtime — from the attendance-derived overtime minutes at the configured
  // multiple of the hourly rate. Hourly rate = basic / (expected working days ×
  // standard workday hours), so it prorates with the same divisor as leave.
  const workdays = Math.max(1, attendance.expectedWorkingDays);
  const standardHoursPerDay = Math.max(0.5, settings.standardWorkdayMinutes / 60);
  const overtimeRateCentsPerHour = Math.round((basicCents / (workdays * standardHoursPerDay)) * (settings.overtimeMultiplier || 1));
  const overtimeMinutes = Math.max(0, Math.round(attendance.overtimeMinutes));
  const overtimeCents = Math.round((overtimeMinutes / 60) * overtimeRateCentsPerHour);
  if (overtimeCents > 0) earnings.push({ key: "overtime", label: `Overtime (${(overtimeMinutes / 60).toFixed(2)}h × ${settings.overtimeMultiplier}×)`, amountCents: overtimeCents });

  // Leave/absence adjustment — unpaid leave + unauthorized absence prorated on
  // the daily rate. Kept separate from deductions per the spec's calc outputs.
  const dailyRateCents = Math.round(basicCents / workdays);
  const unpaidDays = Math.max(0, attendance.unpaidLeaveDays) + Math.max(0, attendance.absentDays);
  const leaveAdjustmentCents = Math.min(basicCents, Math.round(unpaidDays * dailyRateCents));
  if (leaveAdjustmentCents > 0) deductions.push({ key: "leave_adjustment", label: `Unpaid leave / absence (${unpaidDays}d)`, amountCents: leaveAdjustmentCents });

  const incentivesCents = fixedIncentivesCents + variableIncentivesCents;
  const grossCents = basicCents + allowancesCents + incentivesCents + overtimeCents;
  const deductionsCents = structureDeductionsCents + adjustmentDeductionsCents;
  const taxCents = 0; // placeholder — future tax phase computes here
  const netCents = Math.max(0, grossCents - deductionsCents - leaveAdjustmentCents - taxCents);

  return {
    basicCents,
    allowancesCents,
    fixedIncentivesCents,
    variableIncentivesCents,
    incentivesCents,
    overtimeCents,
    overtimeMinutes,
    overtimeRateCentsPerHour,
    grossCents,
    structureDeductionsCents,
    adjustmentDeductionsCents,
    deductionsCents,
    leaveAdjustmentCents,
    employerContributionsCents,
    taxCents,
    netCents,
    breakdown: { earnings, deductions, employerContributions },
  };
}
