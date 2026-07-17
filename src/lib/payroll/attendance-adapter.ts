// Phase 21 — AttendanceAdapter: the ONE read-only bridge from Payroll into the
// Attendance bounded context. It calls Attendance's own services (getWorkSummary
// + getPeriodCalendar) and NEVER touches attendance tables or re-derives any
// attendance figure. Payroll's only interpretation here is turning worked
// minutes into "overtime minutes" (worked beyond the standard workday) — a
// payroll policy decision applied to the authoritative attendance number.
import { getPeriodCalendar, getWorkSummary } from "@/lib/attendance";
import type { PayrollAttendance } from "./types";

export async function getPayrollAttendance(
  companyId: string,
  userId: string,
  from: string,
  to: string,
  standardWorkdayMinutes: number,
): Promise<PayrollAttendance> {
  const [summary, calendar] = await Promise.all([
    getWorkSummary(companyId, userId, from, to),
    getPeriodCalendar(companyId, from, to),
  ]);

  const expectedWorkingDays = calendar.expectedWorkingDays;
  const presentDays = summary.presentDays;
  const leaveDays = summary.leaveDays;
  // Only "unpaid" leave is docked; paid/casual/sick/emergency are paid.
  const unpaidLeaveDays = summary.leaveDaysByType.unpaid ?? 0;
  // Absent = expected working days not covered by attendance OR approved leave.
  const absentDays = Math.max(0, expectedWorkingDays - presentDays - leaveDays);

  // Overtime = worked minutes beyond the expected worked minutes for the days
  // actually present. Derived from the stored worked-minutes figure — no
  // attendance recomputation.
  const workedMinutes = summary.totalWorkedMinutes;
  const expectedWorkedMinutes = presentDays * standardWorkdayMinutes;
  const overtimeMinutes = Math.max(0, workedMinutes - expectedWorkedMinutes);

  return {
    expectedWorkingDays,
    presentDays,
    leaveDays,
    unpaidLeaveDays,
    absentDays,
    workedMinutes,
    overtimeMinutes,
    lateDays: summary.lateDays,
    leaveDaysByType: summary.leaveDaysByType,
    shiftHistory: summary.shiftHistory,
    holidays: calendar.holidays,
  };
}
