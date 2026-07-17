// Phase 21 — the one route guard for Payroll: session → feature entitlement
// (Platform Feature Management) → payroll permission.
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";
import { hasPayrollPermission, type PayrollPermission } from "./permissions";
import { PayrollError } from "./types";

export async function requirePayroll(
  permission: PayrollPermission,
): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!(await featureService.isEnabled(auth.session.companyId, "payroll"))) {
    return { ok: false, response: NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 }) };
  }
  if (!hasPayrollPermission(auth.session.role, permission)) {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to Payroll" }, { status: 403 }) };
  }
  return auth;
}

export function payrollErrorResponse(err: unknown): NextResponse {
  if (err instanceof PayrollError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}
