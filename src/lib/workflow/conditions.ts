// Phase 23 — the ConditionEngine. Evaluates a nested AND/OR tree of leaf
// conditions against an execution context. Pure and side-effect free, so it is
// trivially unit-testable and safe to run on every trigger. An empty/absent
// condition tree means "always run".
import {
  isConditionGroup, type Condition, type ConditionGroup, type ConditionNode,
  type ConditionOperator, type ExecutionContext, CONDITION_OPERATORS, WorkflowError,
} from "./types";

// Resolve a dot-path ("lead.status", "workflow.threshold") against the context.
export function resolveField(context: ExecutionContext, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = context;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function toTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = new Date(v).getTime(); return Number.isNaN(t) ? null : t; }
  return null;
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

// Evaluate a single leaf condition.
export function evalCondition(context: ExecutionContext, cond: Condition): boolean {
  const actual = resolveField(context, cond.field);
  const expected = cond.value;
  switch (cond.operator) {
    case "equals": return String(actual ?? "") === String(expected ?? "");
    case "not_equals": return String(actual ?? "") !== String(expected ?? "");
    case "contains": return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "starts_with": return String(actual ?? "").toLowerCase().startsWith(String(expected ?? "").toLowerCase());
    case "ends_with": return String(actual ?? "").toLowerCase().endsWith(String(expected ?? "").toLowerCase());
    case "greater_than": { const a = toNumber(actual), b = toNumber(expected); return a != null && b != null && a > b; }
    case "less_than": { const a = toNumber(actual), b = toNumber(expected); return a != null && b != null && a < b; }
    case "date_before": { const a = toTime(actual), b = toTime(expected); return a != null && b != null && a < b; }
    case "date_after": { const a = toTime(actual), b = toTime(expected); return a != null && b != null && a > b; }
    case "is_true": return actual === true || actual === "true";
    case "is_false": return actual === false || actual === "false";
    case "is_empty": return isEmpty(actual);
    case "is_not_empty": return !isEmpty(actual);
    default: return false;
  }
}

// Evaluate a node (leaf or group). AND = every child true; OR = any child true.
export function evaluate(context: ExecutionContext, node: ConditionNode | null | undefined): boolean {
  if (!node) return true; // no conditions ⇒ always run
  if (isConditionGroup(node)) {
    const group = node as ConditionGroup;
    if (group.conditions.length === 0) return true;
    return group.logic === "or"
      ? group.conditions.some((c) => evaluate(context, c))
      : group.conditions.every((c) => evaluate(context, c));
  }
  return evalCondition(context, node as Condition);
}

// Structural validation used when a workflow is saved — keeps garbage out of the
// stored jsonb (and bounds nesting so a pathological tree can't blow the stack).
export function validateConditionNode(node: unknown, depth = 0): ConditionNode | null {
  if (node == null) return null;
  if (depth > 10) throw new WorkflowError("Condition nesting is too deep (max 10 levels)");
  if (typeof node !== "object") throw new WorkflowError("Invalid condition");
  const n = node as Record<string, unknown>;
  if ("logic" in n) {
    if (n.logic !== "and" && n.logic !== "or") throw new WorkflowError("Condition group logic must be 'and' or 'or'");
    if (!Array.isArray(n.conditions)) throw new WorkflowError("Condition group must have a conditions array");
    return { logic: n.logic, conditions: n.conditions.map((c) => validateConditionNode(c, depth + 1)!).filter(Boolean) };
  }
  if (typeof n.field !== "string" || !n.field.trim()) throw new WorkflowError("A condition needs a field");
  if (!CONDITION_OPERATORS.includes(n.operator as ConditionOperator)) throw new WorkflowError(`Unknown operator "${String(n.operator)}"`);
  return { field: n.field.trim(), operator: n.operator as ConditionOperator, value: n.value };
}
