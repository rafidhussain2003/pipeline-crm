// Phase 23 — Workflow Automation permission architecture.
//
//   workflow:view    — see workflows, executions, triggers/actions catalog
//   workflow:run      — manually trigger a workflow
//   workflow:manage   — create / edit / duplicate / disable / archive / publish
//   workflow:admin    — module settings
//
// Today: admin = everything; manager = view + run (no authoring); agent = none
// (automation is not an employee tool — the whole module is hidden from agents,
// like Finance). FUTURE ROLE: a dedicated "automation_manager" (a role-enum
// migration) gets a row here granting manage — no route changes. Platform Owner
// (super_admin) controls the FEATURE, not a company's workflows.
import type { Role } from "@/lib/permissions";

export type WorkflowPermission = "workflow:view" | "workflow:run" | "workflow:manage" | "workflow:admin";

const WORKFLOW_ROLE_PERMISSIONS: Record<Role, ReadonlySet<WorkflowPermission>> = {
  super_admin: new Set(),
  admin: new Set(["workflow:view", "workflow:run", "workflow:manage", "workflow:admin"]),
  manager: new Set(["workflow:view", "workflow:run"]),
  agent: new Set(),
};

export function hasWorkflowPermission(role: Role, permission: WorkflowPermission): boolean {
  return WORKFLOW_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
