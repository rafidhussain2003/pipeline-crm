// Phase 20 — Attendance shared types.
export class AttendanceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type LateStatus = "on_time" | "late" | "very_late";
// "overtime" is a STATUS placeholder only — overtime payment is Payroll's
// concern (Phase 21+); attendance just records that the person stayed past
// their shift end.
export type DepartureStatus = "normal" | "left_early" | "overtime";

export const LEAVE_TYPES = ["casual", "sick", "paid", "unpaid", "emergency"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const HOLIDAY_KINDS = ["national", "company", "optional"] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];

export type AttendanceAction =
  | "check_in"
  | "check_out"
  | "break_start"
  | "break_end"
  | "leave_requested"
  | "leave_approved"
  | "leave_rejected"
  | "leave_cancelled"
  | "manual_adjustment"
  | "shift_assigned";

export interface ShiftLike {
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  veryLateMinutes: number;
  earlyLeaveMinutes: number;
  flexible: boolean;
  timezone?: string | null;
}

// "YYYY-MM-DD" in a given IANA timezone (attendance dates are wall-clock).
export function dateInTz(at: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(at); // en-CA gives YYYY-MM-DD
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

// Minutes since local midnight in a timezone.
export function minutesInTz(at: Date, timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
    const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
    return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  } catch {
    return at.getUTCHours() * 60 + at.getUTCMinutes();
  }
}

export function isValidDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));
}
