// Workflow registry — proves the trigger -> condition -> action pattern
// end-to-end with one real, deliberately simple example, rather than
// building a generic multi-event dispatch system for a single registered
// workflow. Adding a second workflow on a different trigger event means
// adding another `eventBus.on(...)` block below, following the same shape.
import { eventBus } from "../events/bus";
import { createLogger } from "../logger";
import { executeWorkflow } from "./engine";
import type { WorkflowDefinition } from "./types";

const logger = createLogger({ component: "workflow-engine" });

export const logManualLeadsWorkflow: WorkflowDefinition = {
  id: "log-manual-leads",
  name: "Log manually-created leads",
  trigger: { event: "lead.created" },
  conditions: [{ field: "source", operator: "equals", value: "manual" }],
  actions: [{ type: "log", message: "A lead was created manually" }],
};

eventBus.on("lead.created", async (payload) => {
  await executeWorkflow(logManualLeadsWorkflow, { companyId: payload.companyId, source: payload.source }, logger);
});
