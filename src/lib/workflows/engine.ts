import type { Logger } from "../logger";
import { sendNotification } from "../notifications/service";
import type { WorkflowAction, WorkflowCondition, WorkflowContext, WorkflowDefinition } from "./types";

export function evaluateConditions(conditions: WorkflowCondition[] | undefined, context: WorkflowContext): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => {
    const actual = context[c.field];
    return c.operator === "equals" ? actual === c.value : actual !== c.value;
  });
}

async function runAction(action: WorkflowAction, workflow: WorkflowDefinition, context: WorkflowContext, logger: Logger): Promise<void> {
  if (action.type === "notify") {
    if (!context.userId) {
      logger.warn("workflow_notify_skipped_no_user", { workflowId: workflow.id });
      return;
    }
    await sendNotification({
      companyId: context.companyId,
      userId: context.userId,
      type: `workflow.${workflow.id}`,
      title: action.title,
      channel: action.channel,
    });
    return;
  }

  if (action.type === "log") {
    logger.info("workflow_action_log", { workflowId: workflow.id, message: action.message });
    return;
  }

  // action.type === "delay" — intentionally not executed. Sleeping inline
  // here would block the HTTP request that triggered this workflow, which
  // is strictly worse than skipping it. This becomes real once a workflow
  // step can be scheduled as a follow-up job instead of run inline — see
  // src/lib/infra/queue.ts's doc comment on the same limitation.
  logger.warn("workflow_delay_not_supported", { workflowId: workflow.id, ms: action.ms });
}

export async function executeWorkflow(workflow: WorkflowDefinition, context: WorkflowContext, logger: Logger): Promise<void> {
  if (!evaluateConditions(workflow.conditions, context)) {
    logger.debug("workflow_skipped", { workflowId: workflow.id, reason: "conditions_not_met" });
    return;
  }
  logger.info("workflow_triggered", { workflowId: workflow.id, name: workflow.name });
  for (const action of workflow.actions) {
    await runAction(action, workflow, context, logger);
  }
}
