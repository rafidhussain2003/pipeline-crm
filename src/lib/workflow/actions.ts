// Phase 23 — the ActionRegistry. Like the TriggerRegistry, a code-side registry
// so future actions register themselves with one registerAction() call and the
// engine executes them without change.
//
// Execution-effect policy for THIS phase (the automation *layer* — per-module
// wiring lands as each module adopts it):
//   • send_notification — a REAL internal write (notifications table), the
//     demonstrable live effect.
//   • delay / wait_until — REAL control-flow timing.
//   • everything else — validates + resolves its config and RECORDS its intended
//     effect in the execution log rather than performing a live cross-module or
//     external side effect. send_sms and create_finance_entry are the spec's
//     explicit placeholders; the rest are "recorded, pending live wiring" — the
//     safe default that keeps a misconfigured workflow from ever touching real
//     data or firing an unapproved external call during this phase.
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { ExecutionContext } from "./types";

export interface ActionContext {
  companyId: string;
  actorUserId: string | null;
  execution: { id: string; workflowId: string; workflowVersion: number };
  context: ExecutionContext;
}
export interface ActionResult {
  ok: boolean;
  output?: Record<string, unknown>;
  message?: string;
}
export interface ActionConfigField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select";
  options?: string[];
  placeholder?: string;
}
export interface ActionDef {
  key: string;
  label: string;
  description: string;
  category: "crm" | "communication" | "hr" | "finance" | "control" | "integration";
  // Records its intent instead of performing a live side effect in this phase.
  recordsIntent?: boolean;
  // A spec-designated placeholder (SMS, finance entry) — architecture only.
  placeholder?: boolean;
  configFields?: ActionConfigField[];
  run(ctx: ActionContext, config: Record<string, unknown>): Promise<ActionResult>;
}

const REGISTRY = new Map<string, ActionDef>();

export function registerAction(def: ActionDef): void {
  REGISTRY.set(def.key, def);
}
export function getAction(key: string): ActionDef | undefined {
  return REGISTRY.get(key);
}
export function isRegisteredAction(key: string): boolean {
  return REGISTRY.has(key);
}
export function listActions(): ActionDef[] {
  return [...REGISTRY.values()];
}

// Helper for the record-intent actions.
function recorded(effect: string, config: Record<string, unknown>): ActionResult {
  return { ok: true, output: { effect, config }, message: `Recorded intent: ${effect}` };
}

// ── The initial action catalog ───────────────────────────────────────────────
const INITIAL: ActionDef[] = [
  {
    key: "assign_lead", label: "Assign Lead", description: "Assign the lead to an agent (or via a routing mode).", category: "crm", recordsIntent: true,
    configFields: [{ key: "agentId", label: "Agent (user id or {{lead.ownerId}})", type: "text" }, { key: "mode", label: "Mode", type: "select", options: ["specific", "round_robin", "ai"] }],
    async run(_ctx, config) { return recorded("assign_lead", config); },
  },
  {
    key: "update_lead", label: "Update Lead", description: "Update fields on the triggering lead (status, tags, custom fields).", category: "crm", recordsIntent: true,
    configFields: [{ key: "status", label: "New status", type: "text" }, { key: "note", label: "Note", type: "textarea" }],
    async run(_ctx, config) { return recorded("update_lead", config); },
  },
  {
    key: "create_task", label: "Create Task", description: "Create a follow-up task / callback.", category: "crm", recordsIntent: true,
    configFields: [{ key: "title", label: "Title", type: "text" }, { key: "dueAt", label: "Due at (ISO)", type: "text" }, { key: "assigneeId", label: "Assignee (user id)", type: "text" }],
    async run(_ctx, config) { return recorded("create_task", config); },
  },
  {
    key: "send_notification", label: "Send Internal Notification", description: "Create an in-app notification for a company user (a live effect).", category: "communication",
    configFields: [{ key: "userId", label: "User (id or {{lead.ownerId}})", type: "text" }, { key: "title", label: "Title", type: "text" }, { key: "body", label: "Body", type: "textarea" }],
    async run(ctx, config) {
      const userId = String(config.userId ?? "").trim();
      const title = String(config.title ?? "Workflow notification").slice(0, 255);
      const body = config.body != null ? String(config.body) : null;
      if (!userId) return { ok: true, output: { skipped: "no target user" }, message: "No target user resolved — nothing sent." };
      const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.companyId, ctx.companyId))).limit(1);
      if (!u) return { ok: true, output: { skipped: "user not in company" }, message: "Target user is not in this company — skipped." };
      const [n] = await db.insert(notifications).values({ companyId: ctx.companyId, userId, type: String(config.type ?? "workflow.notification").slice(0, 100), title, body }).returning({ id: notifications.id });
      return { ok: true, output: { notificationId: n.id, userId }, message: "Internal notification created." };
    },
  },
  {
    key: "send_email", label: "Send Email", description: "Send a transactional email (recorded pending provider wiring).", category: "communication", recordsIntent: true,
    configFields: [{ key: "to", label: "To", type: "text" }, { key: "subject", label: "Subject", type: "text" }, { key: "body", label: "Body", type: "textarea" }],
    async run(_ctx, config) { return recorded("send_email", config); },
  },
  {
    key: "send_sms", label: "Send SMS", description: "Send an SMS message. PLACEHOLDER — architecture only.", category: "communication", recordsIntent: true, placeholder: true,
    configFields: [{ key: "to", label: "To", type: "text" }, { key: "message", label: "Message", type: "textarea" }],
    async run(_ctx, config) { return recorded("send_sms (placeholder)", config); },
  },
  {
    key: "create_note", label: "Create CRM Note", description: "Attach a note to the triggering lead/customer.", category: "crm", recordsIntent: true,
    configFields: [{ key: "leadId", label: "Lead (id or {{lead.id}})", type: "text" }, { key: "body", label: "Note", type: "textarea" }],
    async run(_ctx, config) { return recorded("create_note", config); },
  },
  {
    key: "create_activity", label: "Create Activity", description: "Log a timeline activity on the record.", category: "crm", recordsIntent: true,
    configFields: [{ key: "type", label: "Activity type", type: "text" }, { key: "description", label: "Description", type: "textarea" }],
    async run(_ctx, config) { return recorded("create_activity", config); },
  },
  {
    key: "call_internal_api", label: "Call Internal API", description: "Invoke an internal endpoint (recorded — no live call this phase).", category: "integration", recordsIntent: true,
    configFields: [{ key: "path", label: "Path", type: "text" }, { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PATCH", "DELETE"] }],
    async run(_ctx, config) { return recorded("call_internal_api", config); },
  },
  {
    key: "delay", label: "Delay", description: "Pause before the next step (short delays run inline).", category: "control",
    configFields: [{ key: "seconds", label: "Seconds", type: "number" }],
    async run(_ctx, config) {
      const seconds = Math.max(0, Number(config.seconds ?? 0));
      const ms = Number.isFinite(seconds) ? seconds * 1000 : 0;
      const capped = Math.min(ms, 3000);
      if (capped > 0) await new Promise((r) => setTimeout(r, capped));
      const suspended = ms > capped;
      return { ok: true, output: { requestedMs: ms, waitedMs: capped, suspended }, message: suspended ? `Delayed ${capped}ms (requested ${ms}ms — long delays are recorded, not truly suspended this phase)` : `Delayed ${capped}ms` };
    },
  },
  {
    key: "wait_until", label: "Wait Until", description: "Hold until a timestamp is reached.", category: "control",
    configFields: [{ key: "until", label: "Until (ISO timestamp)", type: "text" }],
    async run(_ctx, config) {
      const until = config.until ? new Date(String(config.until)) : null;
      if (!until || Number.isNaN(until.getTime())) return { ok: true, output: { skipped: "no valid until" }, message: "No valid 'until' timestamp." };
      const satisfied = until.getTime() <= Date.now();
      return { ok: true, output: { until: until.toISOString(), satisfied }, message: satisfied ? "Wait-until already elapsed." : "Would wait until the target time (recorded)." };
    },
  },
  {
    key: "webhook_call", label: "Webhook Call", description: "POST to an external URL (recorded — no live call this phase).", category: "integration", recordsIntent: true,
    configFields: [{ key: "url", label: "URL", type: "text" }, { key: "method", label: "Method", type: "select", options: ["POST", "GET", "PUT"] }],
    async run(_ctx, config) { return recorded("webhook_call", config); },
  },
  {
    key: "update_employee", label: "Update Employee", description: "Update an HR employee record (recorded pending live wiring).", category: "hr", recordsIntent: true,
    configFields: [{ key: "employeeId", label: "Employee (id or {{employee.id}})", type: "text" }, { key: "field", label: "Field", type: "text" }, { key: "value", label: "Value", type: "text" }],
    async run(_ctx, config) { return recorded("update_employee", config); },
  },
  {
    key: "create_finance_entry", label: "Create Finance Entry", description: "Create a finance journal entry. PLACEHOLDER — architecture only.", category: "finance", recordsIntent: true, placeholder: true,
    configFields: [{ key: "type", label: "Type", type: "select", options: ["revenue", "expense", "journal"] }, { key: "amount", label: "Amount", type: "number" }],
    async run(_ctx, config) { return recorded("create_finance_entry (placeholder)", config); },
  },
];

for (const a of INITIAL) registerAction(a);
