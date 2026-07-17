// Phase 22 — the one route guard for HR: session → feature entitlement
// (Platform Feature Management) → HR permission.
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";
import { hasHRPermission, type HRPermission } from "./permissions";
import { HRError } from "./types";

export async function requireHR(
  permission: HRPermission,
): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!(await featureService.isEnabled(auth.session.companyId, "hr"))) {
    return { ok: false, response: NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 }) };
  }
  if (!hasHRPermission(auth.session.role, permission)) {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to HR" }, { status: 403 }) };
  }
  return auth;
}

export function hrErrorResponse(err: unknown): NextResponse {
  if (err instanceof HRError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}
