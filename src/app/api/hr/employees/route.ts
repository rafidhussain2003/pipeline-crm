import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { createEmployee, listEmployees, listUnprofiledUsers } from "@/lib/hr";

// The employee directory. ?unprofiled=1 lists company users without an HR
// profile (the "add employee" picker).
export async function GET(req: NextRequest) {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  if (p.get("unprofiled") === "1") return NextResponse.json({ users: await listUnprofiledUsers(auth.session.companyId) });
  const employees = await listEmployees(auth.session.companyId, {
    search: p.get("search") || undefined,
    departmentId: p.get("departmentId") || undefined,
    status: p.get("status") || undefined,
    limit: Number(p.get("limit")) || 50,
    offset: Number(p.get("offset")) || 0,
  });
  return NextResponse.json({ employees });
}

export async function POST(req: NextRequest) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const employee = await createEmployee(auth.session.companyId, auth.session.userId, {
      userId: String(b?.userId ?? ""),
      employeeCode: typeof b?.employeeCode === "string" ? b.employeeCode : undefined,
      firstName: String(b?.firstName ?? ""),
      lastName: b?.lastName ?? null,
      preferredName: b?.preferredName ?? null,
      dateOfBirth: b?.dateOfBirth || null,
      gender: b?.gender || null,
      joiningDate: b?.joiningDate || null,
      employmentStatus: typeof b?.employmentStatus === "string" ? b.employmentStatus : undefined,
      departmentId: b?.departmentId || null,
      designationId: b?.designationId || null,
      employmentTypeId: b?.employmentTypeId || null,
      managerUserId: b?.managerUserId || null,
      workLocation: b?.workLocation || null,
      notes: b?.notes || null,
    });
    return NextResponse.json({ employee }, { status: 201 });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
