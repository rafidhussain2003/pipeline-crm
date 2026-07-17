import { NextRequest, NextResponse } from "next/server";
import { requireHR } from "@/lib/hr/guard";
import { getEmployeeDirectory, resolveEmployee } from "@/lib/hr";

// The integration read: the canonical employee directory other modules
// consume. ?userId= resolves a single employee (what Attendance/Payroll hold).
export async function GET(req: NextRequest) {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  const userId = req.nextUrl.searchParams.get("userId");
  if (userId) {
    const entry = await resolveEmployee(auth.session.companyId, userId);
    if (!entry) return NextResponse.json({ error: "No HR profile for that user" }, { status: 404 });
    return NextResponse.json({ employee: entry });
  }
  const map = await getEmployeeDirectory(auth.session.companyId);
  return NextResponse.json({ directory: [...map.values()] });
}
