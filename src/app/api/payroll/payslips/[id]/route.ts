import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { getPayslip, hasPayrollPermission } from "@/lib/payroll";

// One payslip. Employees are restricted to their own; managers/admins
// (payroll:view) may open anyone's.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayroll("payroll:view_own");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const restrictToUserId = hasPayrollPermission(auth.session.role, "payroll:view") ? undefined : auth.session.userId;
  try {
    return NextResponse.json({ payslip: await getPayslip(auth.session.companyId, id, restrictToUserId) });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
