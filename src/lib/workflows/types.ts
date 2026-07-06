import type { EventType } from "../events/bus";
import type { NotificationChannel } from "../notifications/types";

export type WorkflowCondition = {
  field: string;
  operator: "equals" | "not_equals";
  value: unknown;
};

export type WorkflowAction =
  | { type: "notify"; title: string; channel?: NotificationChannel }
  | { type: "log"; message: string }
  // Defined but NOT executed today — see engine.ts. A real delay needs to
  // schedule a follow-up job to run later (the job queue's future
  // Redis-backed async execution), not block the request that triggered
  // the workflow by sleeping inline.
  | { type: "delay"; ms: number };

export type WorkflowDefinition = {
  id: string;
  name: string;
  trigger: { event: EventType };
  // All conditions must pass (AND) for the workflow's actions to run.
  conditions?: WorkflowCondition[];
  // Actions run in order. Execution stops being "immediate and complete"
  // once a `delay` action is hit — see engine.ts.
  actions: WorkflowAction[];
};

export type WorkflowContext = {
  companyId: string;
  userId?: string;
  [key: string]: unknown;
};
