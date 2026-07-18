// Phase 23 — the TriggerRegistry. THE extensibility seam: a future module makes
// its events automatable with a single registerTrigger() call at import time —
// the engine, the builder's trigger picker, and the emit path all read this
// registry and never hard-code a trigger type. Nothing in the engine changes
// when a new trigger is added.

// `kind` distinguishes real module events from the three meta-triggers that
// have no source module (manual/scheduled/webhook are fired by the engine's own
// surfaces). `sampleVariables` documents the namespaces a trigger's payload
// carries, powering the builder's field hints.
export interface TriggerDef {
  key: string;
  label: string;
  module: string;
  description: string;
  kind: "event" | "manual" | "scheduled" | "webhook";
  sampleVariables?: string[];
}

const REGISTRY = new Map<string, TriggerDef>();

export function registerTrigger(def: TriggerDef): void {
  REGISTRY.set(def.key, def);
}
export function getTrigger(key: string): TriggerDef | undefined {
  return REGISTRY.get(key);
}
export function isRegisteredTrigger(key: string): boolean {
  return REGISTRY.has(key);
}
export function listTriggers(): TriggerDef[] {
  return [...REGISTRY.values()];
}
export function listTriggersByModule(): Record<string, TriggerDef[]> {
  const out: Record<string, TriggerDef[]> = {};
  for (const t of REGISTRY.values()) (out[t.module] ??= []).push(t);
  return out;
}

// ── The initial trigger catalog. Future modules append via registerTrigger. ──
const INITIAL: TriggerDef[] = [
  // CRM
  { key: "lead.created", label: "CRM Lead Created", module: "crm", kind: "event", description: "A new lead enters the CRM from any source.", sampleVariables: ["lead", "customer"] },
  { key: "lead.assigned", label: "Lead Assigned", module: "crm", kind: "event", description: "A lead is assigned (or reassigned) to an agent.", sampleVariables: ["lead", "agent"] },
  { key: "lead.status_changed", label: "Lead Status Changed", module: "crm", kind: "event", description: "A lead moves to a different pipeline status.", sampleVariables: ["lead"] },
  { key: "customer.created", label: "Customer Created", module: "crm", kind: "event", description: "A lead is converted into a customer.", sampleVariables: ["customer", "lead"] },
  // Mailbox
  { key: "email.received", label: "Email Received", module: "internal_mailbox", kind: "event", description: "An inbound email arrives in a monitored mailbox.", sampleVariables: ["email"] },
  // Meta
  { key: "meta.lead_imported", label: "Meta Lead Imported", module: "meta_integration", kind: "event", description: "A historical Meta/Facebook lead is imported.", sampleVariables: ["lead"] },
  // Attendance
  { key: "attendance.check_in", label: "Attendance Check In", module: "attendance", kind: "event", description: "An employee checks in.", sampleVariables: ["attendance", "employee"] },
  { key: "attendance.check_out", label: "Attendance Check Out", module: "attendance", kind: "event", description: "An employee checks out.", sampleVariables: ["attendance", "employee"] },
  { key: "leave.approved", label: "Leave Approved", module: "attendance", kind: "event", description: "A leave request is approved.", sampleVariables: ["leave", "employee"] },
  // Payroll
  { key: "payroll.approved", label: "Payroll Approved", module: "payroll", kind: "event", description: "A payroll run is approved.", sampleVariables: ["payroll"] },
  { key: "payroll.paid", label: "Payroll Paid", module: "payroll", kind: "event", description: "A payroll run is marked paid.", sampleVariables: ["payroll"] },
  // Finance
  { key: "expense.created", label: "Expense Created", module: "finance", kind: "event", description: "A new expense is recorded.", sampleVariables: ["finance", "expense"] },
  { key: "revenue.created", label: "Revenue Created", module: "finance", kind: "event", description: "New revenue is recorded.", sampleVariables: ["finance", "revenue"] },
  { key: "journal.posted", label: "Journal Posted", module: "finance", kind: "event", description: "A journal entry is posted to the ledger.", sampleVariables: ["finance", "journal"] },
  // HR
  { key: "employee.created", label: "Employee Created", module: "hr", kind: "event", description: "A new employee master record is created.", sampleVariables: ["employee"] },
  { key: "employee.updated", label: "Employee Updated", module: "hr", kind: "event", description: "An employee master record is updated.", sampleVariables: ["employee"] },
  // Core meta-triggers (no source module — fired by the engine's own surfaces).
  { key: "manual", label: "Manual Trigger", module: "core", kind: "manual", description: "Run on demand from the workflow screen or an API call.", sampleVariables: ["input"] },
  { key: "scheduled", label: "Scheduled Trigger", module: "core", kind: "scheduled", description: "Run on a schedule (cron expression in the trigger config).", sampleVariables: ["input"] },
  { key: "webhook", label: "Webhook Trigger", module: "core", kind: "webhook", description: "Run when an external system posts to the workflow's webhook URL.", sampleVariables: ["input", "webhook"] },
];

for (const t of INITIAL) registerTrigger(t);
