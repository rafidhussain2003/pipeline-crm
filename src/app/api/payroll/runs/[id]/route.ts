import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { approveRun, calculateRun, deleteRun, getRun, lockRun, markPaid } from "@/lib/payroll";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const run = await getRun(auth.session.companyId, id);
  if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
  return NextResponse.json({ run });
}

// { action: "calculate" | "approve" | "lock" | "pay", paymentAccountCode? }
// calculate = manage; approve/lock/pay = approve (money-moving).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  try {
    if (action === "calculate") {
      const auth = await requirePayroll("payroll:manage");
      if (!auth.ok) return auth.response;
      return NextResponse.json({ run: await calculateRun(auth.session.companyId, auth.session.userId, id) });
    }
    if (action === "approve" || action === "lock" || action === "pay") {
      const auth = await requirePayroll("payroll:approve");
      if (!auth.ok) return auth.response;
      const { companyId, userId } = auth.session;
      if (action === "approve") return NextResponse.json({ run: await approveRun(companyId, userId, id) });
      if (action === "lock") return NextResponse.json({ run: await lockRun(companyId, userId, id) });
      return NextResponse.json({ run: await markPaid(companyId, userId, id, typeof body?.paymentAccountCode === "string" ? body.paymentAccountCode : undefined) });
    }
    return NextResponse.json({ error: "action must be calculate, approve, lock or pay" }, { status: 400 });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayroll("payroll:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteRun(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
