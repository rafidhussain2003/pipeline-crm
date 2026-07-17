// Phase 21 — public surface of the Payroll bounded context. Payroll is the
// TOP of the module stack: it consumes Finance (JournalService) and Attendance
// (getWorkSummary/getPeriodCalendar) and is consumed by nothing.
export {
  PayrollError, centsToMoney, moneyToCents, isValidDateStr,
  PAY_FREQUENCIES, COMPONENT_TYPES, INCENTIVE_CATEGORIES, DEDUCTION_CATEGORIES, PROFILE_STATUSES, RUN_STATUSES,
} from "./types";
export type { PayFrequency, ComponentType, StructureComponent, AdjustmentKind, RunStatus, PayrollAttendance, ResolvedAdjustment } from "./types";

export { hasPayrollPermission } from "./permissions";
export type { PayrollPermission } from "./permissions";

export { calculatePayroll } from "./calculation";
export type { PayrollCalculation, CalcStructure, CalcSettings } from "./calculation";

export { getPayrollAttendance } from "./attendance-adapter";
export { ensurePayrollSetup, getPayrollSettings, updatePayrollSettings } from "./settings";

export { createStructure, reviseStructure, getStructure, listStructures, structureHistory } from "./structures";
export type { StructureInput } from "./structures";

export { getProfile, listProfiles, upsertProfile } from "./profiles";
export type { ProfileInput } from "./profiles";

export { createAdjustment, cancelAdjustment, listAdjustments, resolveForPeriod } from "./adjustments";
export type { AdjustmentInput } from "./adjustments";

export { createRun, getRun, listRuns, calculateRun, approveRun, lockRun, markPaid, deleteRun, salaryRegister } from "./runs";
export { getPayslip, listPayslipsForUser } from "./payslips";
export { payrollDashboard } from "./dashboard";

// Report placeholders (architecture only — Phase 21 builds no reports).
export interface PayrollReportDef {
  key: string;
  label: string;
  implemented: boolean;
}
export const PAYROLL_REPORTS: readonly PayrollReportDef[] = [
  { key: "payroll_summary", label: "Payroll Summary", implemented: false },
  { key: "cost_analysis", label: "Cost Analysis", implemented: false },
  { key: "department_payroll", label: "Department Payroll", implemented: false },
  { key: "annual_payroll", label: "Annual Payroll", implemented: false },
  { key: "tax_reports", label: "Tax Reports", implemented: false },
] as const;

// The named service facade matching the spec's service list.
import * as calc from "./calculation";
import * as structures from "./structures";
import * as profiles from "./profiles";
import * as runs from "./runs";
import * as payslips from "./payslips";
import * as finance from "./finance-integration";
import * as attendance from "./attendance-adapter";

export const payrollService = {
  PayrollService: profiles, // employee profiles
  CalculationService: calc,
  SalaryStructureService: structures,
  PayrollRunService: runs,
  PayslipService: payslips,
  FinanceIntegrationService: finance,
  AttendanceAdapter: attendance,
};
