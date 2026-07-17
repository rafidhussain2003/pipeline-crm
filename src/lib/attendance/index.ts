// Phase 20 — public surface of the Attendance bounded context. Payroll
// (Phase 21+) consumes ONLY these services — getWorkSummary is its seam.
export { AttendanceError, LEAVE_TYPES, LEAVE_STATUSES, HOLIDAY_KINDS, dateInTz, minutesInTz, isValidDateStr } from "./types";
export type { LateStatus, DepartureStatus, LeaveType, LeaveStatus, HolidayKind, AttendanceAction, ShiftLike } from "./types";

export { evaluateCheckIn, evaluateCheckOut } from "./shift-engine";
export type { CheckInEvaluation, CheckOutEvaluation } from "./shift-engine";

export {
  ensureAttendanceSetup, listShifts, getShift, createShift, updateShift, deleteShift,
  assignShift, resolveShiftFor, shiftTimezone,
} from "./shifts";

export {
  checkIn, checkOut, startBreak, endBreak, todayStatus, manualAdjust,
  listRecords, attendanceDashboard, getWorkSummary, getPeriodCalendar,
} from "./service";
export type { CheckInContext } from "./service";

export { requestLeave, decideLeave, cancelLeave, listLeaves, leaveBalances } from "./leave";
export { listHolidays, createHoliday, deleteHoliday, isHoliday, upcomingHolidays } from "./holidays";
export { logAttendance, listAttendanceLogs } from "./logs";
export { hasAttendancePermission } from "./permissions";
export type { AttendancePermission } from "./permissions";

// Report placeholders (architecture only — Phase 20 builds no reports).
export interface AttendanceReportDef {
  key: string;
  label: string;
  implemented: boolean;
}
export const ATTENDANCE_REPORTS: readonly AttendanceReportDef[] = [
  { key: "monthly_attendance", label: "Monthly Attendance", implemented: false },
  { key: "late_report", label: "Late Report", implemented: false },
  { key: "leave_report", label: "Leave Report", implemented: false },
  { key: "shift_report", label: "Shift Report", implemented: false },
] as const;

// The named service facade, matching the spec's service list.
import * as shiftsSvc from "./shifts";
import * as attendanceSvc from "./service";
import * as leaveSvc from "./leave";
import * as holidaySvc from "./holidays";
import * as logSvc from "./logs";

export const attendanceService = {
  attendance: attendanceSvc,
  shifts: shiftsSvc,
  leave: leaveSvc,
  holidays: holidaySvc,
  logs: logSvc,
};
