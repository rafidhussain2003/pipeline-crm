import { NextResponse } from "next/server";
import { requirePayroll } from "@/lib/payroll/guard";
import { payrollDashboard } from "@/lib/payroll";

export async function GET() {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json(await payrollDashboard(auth.session.companyId));
}
