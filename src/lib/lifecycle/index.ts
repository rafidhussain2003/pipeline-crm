// Public surface of the Phase 4 Lead Lifecycle & Queue Management module.
export type { LifecycleStage } from "./stages";
export { TERMINAL_STAGES, ACTIVE_STAGES, isTerminalStage, isActiveStage, dispositionToLifecycle } from "./stages";
export { transitionLifecycle, recordStageEvent } from "./service";
export { getQueueConfig, updateQueueConfig, DEFAULT_QUEUE_CONFIG } from "./config";
export type { QueueConfig } from "./config";
export { computeLeadPriority } from "./priority";
export { recycleCompany, recycleAllCompanies } from "./recycling";
export { rebalanceCompany, rebalanceAllCompanies } from "./rebalancing";
export { recoverStaleReservations, recoverOrphanedLeads, runRecovery } from "./recovery";
export { listDeadLetter, deadLetterCount, retryDeadLetter, retryAllDeadLetter } from "./dead-letter";
export type { DeadLetterEntry } from "./dead-letter";
export { getQueueHealth, getSelfOptimizationMetrics } from "./health";
export type { QueueHealth, SelfOptimizationMetrics } from "./health";
