import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { getHRSettings, listEmploymentTypes, updateHRSettings, HR_REPORTS } from "@/lib/hr";

export async function GET() {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  const [settings, types] = await Promise.all([getHRSettings(auth.session.companyId), listEmploymentTypes(auth.session.companyId)]);
  return NextResponse.json({ settings, employmentTypes: types, reports: HR_REPORTS });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireHR("hr:admin");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const settings = await updateHRSettings(auth.session.companyId, {
      employeeCodePrefix: typeof b?.employeeCodePrefix === "string" ? b.employeeCodePrefix : undefined,
      defaultEmploymentTypeId: b?.defaultEmploymentTypeId !== undefined ? b.defaultEmploymentTypeId || null : undefined,
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
