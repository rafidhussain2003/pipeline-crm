// Phase 21 — Payroll shared types + money helpers.
//
// MONEY: everything internal is integer CENTS. The only conversion points are
// centsToMoney() (→ finance's numeric dollars, at the JournalService boundary)
// and moneyToCents() (parsing form input).
export class PayrollError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const PAY_FREQUENCIES = ["monthly", "weekly", "biweekly", "hourly"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

// Salary-structure component types. hra & employer_contribution are PLACEHOLDER
// types (carried through the breakdown as informational earnings/cost, with no
// statutory logic yet); the rest are live.
export const COMPONENT_TYPES = ["allowance", "hra", "fixed_incentive", "employer_contribution", "deduction", "custom"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export interface StructureComponent {
  key: string;
  label: string;
  type: ComponentType;
  amountCents: number;
  taxable?: boolean; // placeholder — no tax engine consumes this yet
}

export const INCENTIVE_CATEGORIES = ["fixed", "performance", "sales", "manual", "recurring"] as const;
export const DEDUCTION_CATEGORIES = ["manual", "recurring", "penalty", "loan", "advance"] as const;
export type AdjustmentKind = "incentive" | "deduction";

export const PROFILE_STATUSES = ["active", "on_hold", "terminated"] as const;
export const RUN_STATUSES = ["draft", "calculated", "approved", "locked", "paid"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export function centsToMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function moneyToCents(amount: unknown): number {
  const n = typeof amount === "string" ? Number(amount) : (amount as number);
  if (typeof n !== "number" || !Number.isFinite(n)) throw new PayrollError("Amount must be a number");
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) throw new PayrollError("Amounts can have at most 2 decimal places");
  return cents;
}

export function isValidDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

// A resolved adjustment fed into the calculation engine.
export interface ResolvedAdjustment {
  id?: string;
  kind: AdjustmentKind;
  category: string;
  label: string;
  amountCents: number;
}

// What the AttendanceAdapter hands the calculation engine — all read from the
// Attendance bounded context, none recomputed here.
export interface PayrollAttendance {
  expectedWorkingDays: number;
  presentDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  workedMinutes: number;
  overtimeMinutes: number;
  lateDays: number;
  leaveDaysByType: Record<string, number>;
  shiftHistory: { workDate: string; shiftName: string | null; workedMinutes: number | null }[];
  holidays: { date: string; name: string; kind: string }[];
}
