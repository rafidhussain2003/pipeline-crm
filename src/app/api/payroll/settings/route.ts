import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { getPayrollSettings, updatePayrollSettings, PAYROLL_REPORTS } from "@/lib/payroll";

export async function GET() {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ settings: await getPayrollSettings(auth.session.companyId), reports: PAYROLL_REPORTS });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePayroll("payroll:admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const settings = await updatePayrollSettings(auth.session.companyId, {
      defaultFrequency: typeof body?.defaultFrequency === "string" ? body.defaultFrequency : undefined,
      overtimeMultiplier: body?.overtimeMultiplier !== undefined ? Number(body.overtimeMultiplier) : undefined,
      standardWorkdayMinutes: body?.standardWorkdayMinutes !== undefined ? Number(body.standardWorkdayMinutes) : undefined,
      standardWorkdaysPerMonth: body?.standardWorkdaysPerMonth !== undefined ? Number(body.standardWorkdaysPerMonth) : undefined,
      payDayOfMonth: body?.payDayOfMonth !== undefined ? Number(body.payDayOfMonth) : undefined,
      salaryExpenseAccountCode: typeof body?.salaryExpenseAccountCode === "string" ? body.salaryExpenseAccountCode : undefined,
      salaryPayableAccountCode: typeof body?.salaryPayableAccountCode === "string" ? body.salaryPayableAccountCode : undefined,
      defaultPaymentAccountCode: typeof body?.defaultPaymentAccountCode === "string" ? body.defaultPaymentAccountCode : undefined,
    });
    return NextResponse.json({ settings });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
