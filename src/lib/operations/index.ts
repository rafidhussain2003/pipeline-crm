// Public surface of the Operations Center module (Phase 7). Read-only: it
// observes existing events + aggregates existing state; it never writes to or
// modifies the assignment engine, presence, lifecycle, billing, or lead flow.
export { getOperationsSnapshot } from "./snapshot";
export type { OpsSnapshot, OpsAgent, SystemStatus } from "./snapshot";
export { activityHub, ensureActivityListeners } from "./activity";
export type { ActivityItem, ActivityType } from "./activity";
export { deriveWarnings } from "./warnings";
export type { OpsWarning, WarningLevel } from "./warnings";
