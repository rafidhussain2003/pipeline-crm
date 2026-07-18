// Phase 23 — public surface of the Workflow Automation Engine. This is the
// automation LAYER every other module can drive: a module makes its events
// automatable by calling emitWorkflowTrigger() (and, in future, registerTrigger
// at import time) — nothing in this engine changes.
export { WorkflowError, WORKFLOW_STATUSES, EXECUTION_STATUSES, CONDITION_OPERATORS, TRIGGER_SOURCES } from "./types";
export type { WorkflowStatus, ExecutionStatus, ConditionOperator, ConditionNode, Condition, ConditionGroup, RetryConfig } from "./types";

export { hasWorkflowPermission } from "./permissions";
export type { WorkflowPermission } from "./permissions";
export { requireWorkflow, workflowErrorResponse, WORKFLOW_FEATURE } from "./guard";

// Registries (extensibility seams).
export { registerTrigger, getTrigger, listTriggers, listTriggersByModule, isRegisteredTrigger } from "./triggers";
export type { TriggerDef } from "./triggers";
export { registerAction, getAction, listActions, isRegisteredAction } from "./actions";
export type { ActionDef, ActionContext, ActionResult } from "./actions";

// Condition engine.
export { evaluate, evalCondition, resolveField, validateConditionNode } from "./conditions";

// Variables.
export { VARIABLE_NAMESPACES, listVariables, upsertVariable, deleteVariable, loadUserVariables, interpolate, resolveConfig } from "./variables";
export type { VariableNamespace } from "./variables";

// Settings.
export { ensureWorkflowSetup, getWorkflowSettings, updateWorkflowSettings } from "./settings";

// WorkflowService.
export {
  createWorkflow, updateWorkflow, getWorkflow, listWorkflows, publishWorkflow,
  disableWorkflow, archiveWorkflow, duplicateWorkflow, listVersions, deleteWorkflow, getWorkflowActions,
} from "./workflows";
export type { WorkflowInput, ListWorkflowsOpts } from "./workflows";

// Execution engine + the integration seam.
export { emitWorkflowTrigger, triggerWorkflowManually, runExecution } from "./engine";
export type { RunResult } from "./engine";

// Retry engine.
export { runRetrySweep, listDeadLetter } from "./retry";

// History.
export { listExecutions, getExecution } from "./history";
export type { ListExecutionsOpts } from "./history";

// Templates.
export { listTemplates, getTemplate, instantiateTemplate, TEMPLATES } from "./templates";
export type { WorkflowTemplate } from "./templates";

// Dashboard.
export { workflowDashboard } from "./dashboard";

// Report placeholders (architecture only — Phase 23 builds no analytics).
export interface WorkflowReportDef {
  key: string;
  label: string;
  implemented: boolean;
}
export const WORKFLOW_REPORTS: readonly WorkflowReportDef[] = [
  { key: "execution_summary", label: "Execution Summary", implemented: false },
  { key: "workflow_performance", label: "Workflow Performance", implemented: false },
  { key: "failure_analysis", label: "Failure Analysis", implemented: false },
  { key: "action_usage", label: "Action Usage", implemented: false },
] as const;

// The named service facade matching the spec's service list.
import * as workflowsSvc from "./workflows";
import * as triggersSvc from "./triggers";
import * as actionsSvc from "./actions";
import * as engineSvc from "./engine";
import * as conditionsSvc from "./conditions";
import * as templatesSvc from "./templates";
import * as historySvc from "./history";

export const workflowService = {
  WorkflowService: workflowsSvc,
  TriggerRegistry: triggersSvc,
  ActionRegistry: actionsSvc,
  ExecutionEngine: engineSvc,
  ConditionEngine: conditionsSvc,
  TemplateService: templatesSvc,
  HistoryService: historySvc,
};
