// Phase 15 — public surface of the callback engine.
export { CALLBACK_REASONS, CALLBACK_PRIORITIES, kindForOffset, labelForKind } from "./types";
export type { CallbackReason, CallbackPriority, CallbackStatus, CallbackChannel, CallbackReminderPayload, ReminderKind } from "./types";
export { getCallbackSettings, updateCallbackSettings, DEFAULT_CALLBACK_SETTINGS } from "./config";
export type { CallbackSettings } from "./config";
export { computePriorityScore } from "./prioritize";
export type { PrioritySignals } from "./prioritize";
export { callbackHub } from "./hub";
export { getChannel, implementedChannels } from "./channels";
export type { ReminderChannel, DeliverInput, DeliverResult } from "./channels";
export { recordCallbackEvent, getCallbackHistory } from "./history";
export type { CallbackEventType } from "./history";
export { scheduleRemindersFor, cancelRemindersFor, processDueReminders, kickCallbackWorker, reclaimStaleReminders, sweepOverdueCallbacks } from "./reminders";
export {
  CallbackError, scheduleCallback, rescheduleCallback, cancelCallback, completeCallback,
  acknowledgeCallback, listCallbacks, callbackCounts, getDueForUser, listCallbacksForLead,
} from "./service";
export type { ScheduleInput, ListInput, CallbackTab } from "./service";
