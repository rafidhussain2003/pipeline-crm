import { NextRequest, NextResponse } from "next/server";
import { requirePayroll } from "@/lib/payroll/guard";
import { hasPayrollPermission, listPayslipsForUser } from "@/lib/payroll";

// Employees list their OWN payslips; a manager/admin may list another
// employee's with ?userId= (requires payroll:view).
export async function GET(req: NextRequest) {
  const auth = await requirePayroll("payroll:view_own");
  if (!auth.ok) return auth.response;
  const wanted = req.nextUrl.searchParams.get("userId");
  const canViewAll = hasPayrollPermission(auth.session.role, "payroll:view");
  const userId = wanted && canViewAll ? wanted : auth.session.userId;
  return NextResponse.json({ payslips: await listPayslipsForUser(auth.session.companyId, userId) });
}
