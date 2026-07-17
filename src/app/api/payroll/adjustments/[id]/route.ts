import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { cancelAdjustment } from "@/lib/payroll";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayroll("payroll:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await cancelAdjustment(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
