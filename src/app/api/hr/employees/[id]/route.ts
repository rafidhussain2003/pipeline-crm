import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { deleteEmployee, getEmployee, getEmployeeByUser, hasHRPermission, listDocuments, updateEmployee } from "@/lib/hr";

// GET one employee. Employees may only fetch their OWN profile (by user id in
// place of an employee id is not allowed — they use ?self=1).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:view_own");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const canViewAll = hasHRPermission(auth.session.role, "hr:view");

  // ?self=1 → the caller's own profile regardless of the id path segment.
  const self = req.nextUrl.searchParams.get("self") === "1";
  const employee = self
    ? await getEmployeeByUser(auth.session.companyId, auth.session.userId)
    : await getEmployee(auth.session.companyId, id);
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (!canViewAll && employee.userId !== auth.session.userId) {
    return NextResponse.json({ error: "You can only view your own profile" }, { status: 403 });
  }
  const documents = await listDocuments(auth.session.companyId, employee.id);
  return NextResponse.json({ employee, documents });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    const employee = await updateEmployee(auth.session.companyId, auth.session.userId, id, {
      firstName: typeof b?.firstName === "string" ? b.firstName : undefined,
      lastName: b?.lastName !== undefined ? b.lastName : undefined,
      preferredName: b?.preferredName !== undefined ? b.preferredName : undefined,
      dateOfBirth: b?.dateOfBirth !== undefined ? b.dateOfBirth || null : undefined,
      gender: b?.gender !== undefined ? b.gender || null : undefined,
      joiningDate: b?.joiningDate !== undefined ? b.joiningDate || null : undefined,
      confirmationDate: b?.confirmationDate !== undefined ? b.confirmationDate || null : undefined,
      employmentStatus: typeof b?.employmentStatus === "string" ? b.employmentStatus : undefined,
      departmentId: b?.departmentId !== undefined ? b.departmentId || null : undefined,
      designationId: b?.designationId !== undefined ? b.designationId || null : undefined,
      employmentTypeId: b?.employmentTypeId !== undefined ? b.employmentTypeId || null : undefined,
      managerUserId: b?.managerUserId !== undefined ? b.managerUserId || null : undefined,
      workLocation: b?.workLocation !== undefined ? b.workLocation : undefined,
      emergencyContact: b?.emergencyContact !== undefined ? b.emergencyContact : undefined,
      profilePhotoUrl: b?.profilePhotoUrl !== undefined ? b.profilePhotoUrl : undefined,
      notes: b?.notes !== undefined ? b.notes : undefined,
    });
    return NextResponse.json({ employee });
  } catch (err) {
    return hrErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteEmployee(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
