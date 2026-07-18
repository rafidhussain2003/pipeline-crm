// Phase 23 — TemplateService. Starter templates are a code registry (same
// extensibility story as triggers/actions) — instantiating one creates a normal
// draft workflow the user then edits and publishes. Every template references
// only REGISTERED trigger + action keys, so a template can never produce an
// invalid workflow.
import { createWorkflow, type WorkflowInput } from "./workflows";
import { WorkflowError } from "./types";

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  definition: WorkflowInput;
}

export const TEMPLATES: readonly WorkflowTemplate[] = [
  {
    key: "lead_assignment",
    name: "Lead Assignment",
    description: "When a lead is created, assign it and notify the owner.",
    category: "CRM",
    definition: {
      name: "Lead Assignment",
      description: "Auto-assign new leads and notify the assigned agent.",
      triggerType: "lead.created",
      conditions: null,
      retryConfig: { maxRetries: 3, backoffSeconds: 30 },
      actions: [
        { actionType: "assign_lead", config: { mode: "round_robin" } },
        { actionType: "send_notification", config: { userId: "{{lead.ownerId}}", title: "New lead assigned", body: "A new lead ({{lead.name}}) has been assigned to you." } },
      ],
    },
  },
  {
    key: "welcome_email",
    name: "Welcome Email",
    description: "Send a welcome email when a customer is created.",
    category: "CRM",
    definition: {
      name: "Welcome Email",
      description: "Greet new customers automatically.",
      triggerType: "customer.created",
      conditions: null,
      retryConfig: { maxRetries: 3, backoffSeconds: 60 },
      actions: [
        { actionType: "send_email", config: { to: "{{customer.email}}", subject: "Welcome to {{global.companyName}}", body: "Hi {{customer.name}}, thanks for joining us!" } },
      ],
    },
  },
  {
    key: "missed_checkin_alert",
    name: "Missed Check-in Alert",
    description: "On a schedule, alert managers about missing attendance check-ins.",
    category: "Attendance",
    definition: {
      name: "Missed Check-in Alert",
      description: "Notify managers when an employee hasn't checked in.",
      triggerType: "scheduled",
      triggerConfig: { cron: "0 11 * * 1-5" },
      conditions: null,
      retryConfig: { maxRetries: 2, backoffSeconds: 60 },
      actions: [
        { actionType: "send_notification", config: { userId: "{{employee.managerUserId}}", title: "Missed check-in", body: "{{employee.name}} has not checked in." } },
      ],
    },
  },
  {
    key: "payroll_approval_notification",
    name: "Payroll Approval Notification",
    description: "Notify finance and email when a payroll run is approved.",
    category: "Payroll",
    definition: {
      name: "Payroll Approval Notification",
      description: "Keep stakeholders informed on payroll approvals.",
      triggerType: "payroll.approved",
      conditions: null,
      retryConfig: { maxRetries: 3, backoffSeconds: 30 },
      actions: [
        { actionType: "send_notification", config: { userId: "{{payroll.approvedBy}}", title: "Payroll approved", body: "Payroll {{payroll.period}} has been approved." } },
        { actionType: "send_email", config: { to: "{{global.financeEmail}}", subject: "Payroll approved: {{payroll.period}}", body: "The payroll run has been approved and is ready to pay." } },
      ],
    },
  },
  {
    key: "expense_approval",
    name: "Expense Approval",
    description: "Route large expenses for approval when they are created.",
    category: "Finance",
    definition: {
      name: "Expense Approval",
      description: "Flag expenses over a threshold for manager approval.",
      triggerType: "expense.created",
      conditions: { logic: "and", conditions: [{ field: "expense.amount", operator: "greater_than", value: 1000 }] },
      retryConfig: { maxRetries: 2, backoffSeconds: 30 },
      actions: [
        { actionType: "create_task", config: { title: "Approve expense {{expense.reference}}", assigneeId: "{{expense.approverId}}" } },
        { actionType: "send_notification", config: { userId: "{{expense.approverId}}", title: "Expense needs approval", body: "An expense of {{expense.amount}} needs your approval." } },
      ],
    },
  },
] as const;

export function listTemplates(): WorkflowTemplate[] {
  return [...TEMPLATES];
}
export function getTemplate(key: string): WorkflowTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

// Instantiate a template into a real draft workflow.
export async function instantiateTemplate(companyId: string, actorUserId: string, key: string) {
  const tpl = getTemplate(key);
  if (!tpl) throw new (await import("./types")).WorkflowError("Unknown template", 404);
  return createWorkflow(companyId, actorUserId, tpl.definition);
}
