// Phase 20 — the one route guard for Attendance: session → feature
// entitlement (Platform Feature Management) → attendance permission.
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";
import { hasAttendancePermission, type AttendancePermission } from "./permissions";
import { AttendanceError } from "./types";

export async function requireAttendance(
  permission: AttendancePermission,
): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!(await featureService.isEnabled(auth.session.companyId, "attendance"))) {
    return { ok: false, response: NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 }) };
  }
  if (!hasAttendancePermission(auth.session.role, permission)) {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to Attendance" }, { status: 403 }) };
  }
  return auth;
}

export function attendanceErrorResponse(err: unknown): NextResponse {
  if (err instanceof AttendanceError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}
