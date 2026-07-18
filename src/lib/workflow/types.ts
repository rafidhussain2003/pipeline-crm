// Phase 23 — Workflow Automation shared types. Status/operator sets are plain
// const arrays (validated in the service layer) so adding a value never needs a
// pg enum-alter migration — same convention as HR/Finance.

export class WorkflowError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// draft → published (live) → disabled (paused) ; archived is terminal.
export const WORKFLOW_STATUSES = ["draft", "published", "disabled", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const EXECUTION_STATUSES = [
  "pending", "running", "success", "failed", "retrying", "dead_letter", "skipped", "waiting",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

// How an execution was triggered.
export const TRIGGER_SOURCES = ["event", "manual", "scheduled", "webhook", "retry"] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

// The condition operators the engine understands.
export const CONDITION_OPERATORS = [
  "equals", "not_equals", "contains", "starts_with", "ends_with",
  "greater_than", "less_than", "date_before", "date_after",
  "is_true", "is_false", "is_empty", "is_not_empty",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

// A single leaf condition — a dot-path field, an operator, and an optional
// comparison value. `field` resolves against the execution context (e.g.
// "lead.status", "employee.department", "workflow.threshold").
export interface Condition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

// A boolean group of conditions/sub-groups — the nesting that gives AND/OR
// composition (HubSpot/Salesforce style).
export interface ConditionGroup {
  logic: "and" | "or";
  conditions: ConditionNode[];
}
export type ConditionNode = Condition | ConditionGroup;

export function isConditionGroup(n: ConditionNode | null | undefined): n is ConditionGroup {
  return !!n && typeof n === "object" && "logic" in n && Array.isArray((n as ConditionGroup).conditions);
}

export interface RetryConfig {
  maxRetries: number;
  backoffSeconds: number;
}

// One ordered action step as authored in the builder.
export interface ActionStepInput {
  actionType: string;
  config?: Record<string, unknown>;
  continueOnError?: boolean;
}

// The variable context an execution runs against. Keys are namespaces
// (lead, employee, payroll, attendance, finance, customer, workflow, global,
// execution, trigger); values are arbitrary payloads from the trigger + vars.
export type ExecutionContext = Record<string, unknown>;

export function validateWorkflowName(name: string): string {
  const n = (name ?? "").trim();
  if (n.length < 1 || n.length > 160) throw new WorkflowError("Workflow name must be 1–160 characters");
  return n;
}
