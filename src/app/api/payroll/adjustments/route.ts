import { NextRequest, NextResponse } from "next/server";
import { requirePayroll, payrollErrorResponse } from "@/lib/payroll/guard";
import { createAdjustment, listAdjustments } from "@/lib/payroll";
import type { AdjustmentKind } from "@/lib/payroll";

// Incentives + deductions. ?kind=incentive|deduction filters (the Incentives
// and Deductions pages each pass one).
export async function GET(req: NextRequest) {
  const auth = await requirePayroll("payroll:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const kind = p.get("kind");
  return NextResponse.json({
    adjustments: await listAdjustments(auth.session.companyId, {
      kind: kind === "incentive" || kind === "deduction" ? (kind as AdjustmentKind) : undefined,
      userId: p.get("userId") || undefined,
      status: p.get("status") || undefined,
    }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePayroll("payroll:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const adjustment = await createAdjustment(auth.session.companyId, auth.session.userId, {
      userId: String(body?.userId ?? ""),
      kind: String(body?.kind ?? ""),
      category: String(body?.category ?? ""),
      label: String(body?.label ?? ""),
      amount: Number(body?.amount),
      recurring: !!body?.recurring,
      effectiveDate: String(body?.effectiveDate ?? ""),
      endDate: typeof body?.endDate === "string" ? body.endDate : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ adjustment }, { status: 201 });
  } catch (err) {
    return payrollErrorResponse(err);
  }
}
