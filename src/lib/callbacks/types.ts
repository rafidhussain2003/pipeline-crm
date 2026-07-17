// Phase 15 — Callback engine shared types + vocabulary.
export const CALLBACK_REASONS = [
  "Customer requested callback",
  "Busy right now",
  "Requested after work",
  "Requested next week",
  "Payment pending",
  "Installation follow-up",
  "Other",
] as const;
export type CallbackReason = (typeof CALLBACK_REASONS)[number];

export const CALLBACK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type CallbackPriority = (typeof CALLBACK_PRIORITIES)[number];

export type CallbackStatus = "scheduled" | "due" | "completed" | "missed" | "cancelled" | "rescheduled";

// Reminder offsets are minutes relative to the scheduled time: negative =
// before, 0 = at the time, positive = overdue.
export type ReminderKind = "before_15" | "before_5" | "at_time" | "overdue_15" | "overdue_60" | string;

export function kindForOffset(minutes: number): ReminderKind {
  if (minutes === 0) return "at_time";
  if (minutes < 0) return `before_${Math.abs(minutes)}`;
  return `overdue_${minutes}`;
}

export function labelForKind(kind: string): string {
  if (kind === "at_time") return "Callback due now";
  if (kind.startsWith("before_")) return `Callback in ${kind.slice(7)} minutes`;
  if (kind.startsWith("overdue_")) {
    const m = Number(kind.slice(8));
    return m >= 60 ? `Callback ${Math.round(m / 60)}h overdue` : `Callback ${m} minutes overdue`;
  }
  return "Callback reminder";
}

// FUTURE-READY: the channel a reminder is delivered through. Only "in_app" is
// implemented today (see ./channels). Adding email/sms/whatsapp/voice/calendar
// later means registering a channel — no schema or call-site change.
export type CallbackChannel = "in_app" | "email" | "sms" | "whatsapp" | "voice" | "calendar";

// What the client receives over SSE when a reminder fires.
export interface CallbackReminderPayload {
  callbackId: string;
  leadId: string;
  leadName: string | null;
  kind: ReminderKind;
  label: string;
  scheduledAt: string; // ISO
  reason: string;
  priority: CallbackPriority;
  priorityScore: number;
  status: CallbackStatus;
  at: string; // ISO — when the reminder fired
}
