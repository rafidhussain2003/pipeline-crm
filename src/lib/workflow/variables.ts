// Phase 23 — variables. Two kinds coexist in one context:
//  • USER-defined (workflow-scoped + global) — stored in workflow_variables,
//    managed on the Variables screen, merged into the context under the
//    `workflow.` and `global.` namespaces.
//  • RUNTIME namespaces (lead., employee., payroll., attendance., finance.,
//    customer., execution., trigger.) — NOT stored; they arrive on the trigger
//    payload and are made available to conditions + action configs.
// `{{ path }}` templates in action configs are resolved against this context.
import { db } from "@/db";
import { workflowVariables } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { resolveField } from "./conditions";
import { WorkflowError, type ExecutionContext } from "./types";

export interface VariableNamespace {
  key: string;
  label: string;
  source: "user" | "runtime";
  description: string;
}

// The catalog surfaced on the Variables screen + the builder's hints.
export const VARIABLE_NAMESPACES: readonly VariableNamespace[] = [
  { key: "workflow", label: "Workflow Variables", source: "user", description: "Values scoped to a single workflow." },
  { key: "global", label: "Global Variables", source: "user", description: "Company-wide values shared by every workflow." },
  { key: "lead", label: "Lead Variables", source: "runtime", description: "The lead on the triggering event (status, source, owner…)." },
  { key: "customer", label: "Customer Variables", source: "runtime", description: "The customer on the triggering event." },
  { key: "employee", label: "Employee Variables", source: "runtime", description: "The employee (HR master) on the triggering event." },
  { key: "payroll", label: "Payroll Variables", source: "runtime", description: "The payroll run/period on the triggering event." },
  { key: "attendance", label: "Attendance Variables", source: "runtime", description: "The attendance/leave record on the triggering event." },
  { key: "finance", label: "Finance Variables", source: "runtime", description: "The revenue/expense/journal on the triggering event." },
  { key: "execution", label: "Execution Variables", source: "runtime", description: "The current run (id, workflow, attempt, startedAt)." },
] as const;

export const VALUE_TYPES = ["string", "number", "boolean", "json"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

function coerce(value: unknown, type: string): unknown {
  switch (type) {
    case "number": { const n = Number(value); return Number.isFinite(n) ? n : 0; }
    case "boolean": return value === true || value === "true";
    case "json": if (typeof value === "string") { try { return JSON.parse(value); } catch { return value; } } return value;
    default: return value == null ? "" : String(value);
  }
}

// ── User-defined variable CRUD (workflow_variables) ──────────────────────────
export async function listVariables(companyId: string, workflowId?: string | null) {
  const where = workflowId
    ? and(eq(workflowVariables.companyId, companyId), eq(workflowVariables.workflowId, workflowId))
    : and(eq(workflowVariables.companyId, companyId), isNull(workflowVariables.workflowId));
  return db.select().from(workflowVariables).where(where).orderBy(asc(workflowVariables.key));
}

export async function upsertVariable(
  companyId: string,
  input: { id?: string; workflowId?: string | null; key: string; valueType?: string; value?: unknown; description?: string | null },
) {
  const key = (input.key ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)) throw new WorkflowError("Variable key must start with a letter and use letters, digits or underscore (max 80)");
  const valueType = (input.valueType && VALUE_TYPES.includes(input.valueType as ValueType)) ? input.valueType : "string";
  const value = coerce(input.value, valueType);
  const scope = input.workflowId ? "workflow" : "global";
  if (input.id) {
    const [row] = await db.update(workflowVariables)
      .set({ key, valueType, value, description: input.description ?? null, updatedAt: new Date() })
      .where(and(eq(workflowVariables.id, input.id), eq(workflowVariables.companyId, companyId)))
      .returning();
    if (!row) throw new WorkflowError("Variable not found", 404);
    return row;
  }
  try {
    const [row] = await db.insert(workflowVariables)
      .values({ companyId, workflowId: input.workflowId ?? null, scope, key, valueType, value, description: input.description ?? null })
      .returning();
    return row;
  } catch (err) {
    const msg = `${(err as Error).message} ${((err as { cause?: Error }).cause?.message) ?? ""}`;
    if (msg.includes("workflow_variables_global_uniq") || msg.includes("workflow_variables_workflow_uniq")) {
      throw new WorkflowError(`A variable named "${key}" already exists in this scope`);
    }
    throw err;
  }
}

export async function deleteVariable(companyId: string, id: string): Promise<void> {
  const res = await db.delete(workflowVariables).where(and(eq(workflowVariables.id, id), eq(workflowVariables.companyId, companyId))).returning({ id: workflowVariables.id });
  if (res.length === 0) throw new WorkflowError("Variable not found", 404);
}

// Build the `workflow.` and `global.` namespaces for an execution context from
// the stored user variables (global + this workflow's).
export async function loadUserVariables(companyId: string, workflowId: string): Promise<{ workflow: Record<string, unknown>; global: Record<string, unknown> }> {
  const rows = await db.select().from(workflowVariables).where(eq(workflowVariables.companyId, companyId));
  const globalVars: Record<string, unknown> = {};
  const workflowVars: Record<string, unknown> = {};
  for (const r of rows) {
    const v = r.value;
    if (r.workflowId === null) globalVars[r.key] = v;
    else if (r.workflowId === workflowId) workflowVars[r.key] = v;
  }
  return { workflow: workflowVars, global: globalVars };
}

// ── Interpolation ────────────────────────────────────────────────────────────
// Replace {{ path }} tokens. A string that is a SINGLE token returns the raw
// resolved value (type preserved); mixed strings do textual substitution.
const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function interpolate(template: string, context: ExecutionContext): unknown {
  const soleMatch = template.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
  if (soleMatch) return resolveField(context, soleMatch[1]);
  return template.replace(TOKEN, (_, path) => {
    const v = resolveField(context, path);
    return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

// Deep-interpolate every string in an action config against the context.
export function resolveConfig(config: Record<string, unknown> | null | undefined, context: ExecutionContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config ?? {})) {
    if (typeof v === "string") out[k] = interpolate(v, context);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = resolveConfig(v as Record<string, unknown>, context);
    else out[k] = v;
  }
  return out;
}
