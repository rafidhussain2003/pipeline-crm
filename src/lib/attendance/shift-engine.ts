// Phase 20 — the pure shift evaluation engine. No I/O: given a shift and a
// wall-clock minute, classify the check-in (on time / late / very late) and
// the check-out (normal / left early / overtime-status). Kept pure so the
// rules are unit-testable and reusable by future rotating-shift logic.
import type { DepartureStatus, LateStatus, ShiftLike } from "./types";

export interface CheckInEvaluation {
  lateStatus: LateStatus;
  lateMinutes: number;
}

// minuteOfDay = the check-in moment expressed as minutes since local midnight
// in the shift's timezone. Overnight shifts (endMinute < startMinute): a
// check-in in the early-morning tail (e.g. 00:30 for a 22:00–06:00 shift)
// belongs to the shift that STARTED the previous evening — measured as
// minutes past that start (minuteOfDay + 1440 − start).
export function evaluateCheckIn(shift: ShiftLike, minuteOfDay: number): CheckInEvaluation {
  if (shift.flexible) return { lateStatus: "on_time", lateMinutes: 0 };
  const overnight = shift.endMinute < shift.startMinute;
  let sinceStart = minuteOfDay - shift.startMinute;
  if (overnight && minuteOfDay < shift.endMinute + 120) {
    // Early-morning check-in for last evening's shift (up to 2h past its end
    // still counts against it rather than being "very early" for tonight's).
    sinceStart = minuteOfDay + 1440 - shift.startMinute;
  }
  if (sinceStart <= shift.graceMinutes) return { lateStatus: "on_time", lateMinutes: Math.max(0, sinceStart) };
  if (sinceStart <= shift.graceMinutes + shift.veryLateMinutes) return { lateStatus: "late", lateMinutes: sinceStart };
  return { lateStatus: "very_late", lateMinutes: sinceStart };
}

export interface CheckOutEvaluation {
  departureStatus: DepartureStatus;
  earlyMinutes: number;
}

// minuteOfDay of the check-out, plus whether the checkout happens on a later
// calendar day than the check-in (overnight shifts check out "tomorrow").
export function evaluateCheckOut(shift: ShiftLike, minuteOfDay: number, checkedOutNextDay: boolean): CheckOutEvaluation {
  if (shift.flexible) return { departureStatus: "normal", earlyMinutes: 0 };
  const overnight = shift.endMinute < shift.startMinute;
  // Normalize the checkout minute onto the same axis as the shift end.
  let minute = minuteOfDay;
  let end = shift.endMinute;
  if (overnight) {
    end = shift.endMinute + 1440;
    minute = checkedOutNextDay ? minuteOfDay + 1440 : minuteOfDay;
  }
  const beforeEnd = end - minute;
  if (beforeEnd > shift.earlyLeaveMinutes) return { departureStatus: "left_early", earlyMinutes: beforeEnd };
  if (beforeEnd < 0) return { departureStatus: "overtime", earlyMinutes: 0 }; // status only — payments are Phase 21+
  return { departureStatus: "normal", earlyMinutes: 0 };
}
