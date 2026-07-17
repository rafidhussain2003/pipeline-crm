// Phase 19 — the one route guard for Finance: session + feature entitlement
// (Platform Feature Management) + finance permission, in that order. Every
// /api/finance route wires exactly:
//   const auth = await requireFinance("finance:view");
//   if (!auth.ok) return auth.response;
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";
import { hasFinancePermission, type FinancePermission } from "./permissions";
import { FinanceError } from "./types";

export async function requireFinance(
  permission: FinancePermission,
): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!(await featureService.isEnabled(auth.session.companyId, "finance"))) {
    return { ok: false, response: NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 }) };
  }
  if (!hasFinancePermission(auth.session.role, permission)) {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to Finance" }, { status: 403 }) };
  }
  return auth;
}

// Uniform FinanceError → JSON mapping so route bodies stay two lines.
export function financeErrorResponse(err: unknown): NextResponse {
  if (err instanceof FinanceError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}
