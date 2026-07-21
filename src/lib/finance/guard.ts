// Phase 19 — the one route guard for Finance: session + feature entitlement
// (Platform Feature Management) + finance permission, in that order. Every
// /api/finance route wires exactly:
//   const auth = await requireFinance("finance:view");
//   if (!auth.ok) return auth.response;
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";
import { resolveModuleOverride } from "@/lib/module-access";
import { hasFinancePermission, type FinancePermission } from "./permissions";
import { FinanceError } from "./types";

// Member-level capabilities an explicit module GRANT opens for a role that
// wouldn't otherwise have them. Deliberately excludes finance:manage — a
// grant opens the workspace, it never hands out admin powers inside it.
const GRANTABLE: readonly FinancePermission[] = ["finance:view", "finance:post"];

export async function requireFinance(
  permission: FinancePermission,
): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!(await featureService.isEnabled(auth.session.companyId, "finance"))) {
    return { ok: false, response: NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 }) };
  }
  // Enterprise Workspaces: the admin's per-user assignment. "denied" blocks
  // outright, "granted" opens member capabilities beyond the role default,
  // "default" keeps the pre-existing role logic exactly.
  const override = await resolveModuleOverride(auth.session.userId, auth.session.role, "finance");
  if (override === "denied") {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to Finance" }, { status: 403 }) };
  }
  if (!hasFinancePermission(auth.session.role, permission)) {
    if (!(override === "granted" && GRANTABLE.includes(permission))) {
      return { ok: false, response: NextResponse.json({ error: "You do not have access to Finance" }, { status: 403 }) };
    }
  }
  return auth;
}

// Uniform FinanceError → JSON mapping so route bodies stay two lines.
export function financeErrorResponse(err: unknown): NextResponse {
  if (err instanceof FinanceError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}
