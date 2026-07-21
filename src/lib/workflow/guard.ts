// Phase 23 — the one route guard for Workflow Automation: session → feature
// entitlement (Platform Feature Management) → workflow permission.
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";
import { resolveModuleOverride } from "@/lib/module-access";
import { hasWorkflowPermission, type WorkflowPermission } from "./permissions";
import { WorkflowError } from "./types";

export const WORKFLOW_FEATURE = "workflow";

// Member-level capabilities an explicit module GRANT opens — never
// workflow:manage / workflow:admin.
const GRANTABLE: readonly WorkflowPermission[] = ["workflow:view", "workflow:run"];

export async function requireWorkflow(
  permission: WorkflowPermission,
): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!(await featureService.isEnabled(auth.session.companyId, WORKFLOW_FEATURE))) {
    return { ok: false, response: NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 }) };
  }
  // Enterprise Workspaces: per-user assignment — see lib/module-access.ts.
  const override = await resolveModuleOverride(auth.session.userId, auth.session.role, "workflow");
  if (override === "denied") {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to Workflow Automation" }, { status: 403 }) };
  }
  if (!hasWorkflowPermission(auth.session.role, permission)) {
    if (!(override === "granted" && GRANTABLE.includes(permission))) {
      return { ok: false, response: NextResponse.json({ error: "You do not have access to Workflow Automation" }, { status: 403 }) };
    }
  }
  return auth;
}

export function workflowErrorResponse(err: unknown): NextResponse {
  if (err instanceof WorkflowError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}
