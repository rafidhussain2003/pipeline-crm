import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { createRun, listRuns } from "@/lib/payroll";

export async function GET(req: NextRequest) {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  return NextResponse.json({ runs: await listRuns(auth.session.companyId, { status: p.get("status") || undefined, limit: Number(p.get("limit")) || 50, offset: Number(p.get("offset")) || 0 }) });
}

export async function POST(req: NextRequest) {
  const auth = await requirePayroll("payroll:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const run = await createRun(auth.session.companyId, auth.session.userId, {
      label: String(body?.label ?? ""),
      frequency: String(body?.frequency ?? "monthly"),
      periodStart: String(body?.periodStart ?? ""),
      periodEnd: String(body?.periodEnd ?? ""),
      payDate: String(body?.payDate ?? ""),
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
