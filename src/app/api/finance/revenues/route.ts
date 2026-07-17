import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { createRevenue, listRevenues } from "@/lib/finance";

export async function GET(req: NextRequest) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const revenues = await listRevenues(auth.session.companyId, { limit: Number(p.get("limit")) || 50, offset: Number(p.get("offset")) || 0 });
  return NextResponse.json({ revenues });
}

// Record revenue — posts its balanced journal automatically.
export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const revenue = await createRevenue(auth.session.companyId, auth.session.userId, {
      entryDate: String(body?.entryDate ?? ""),
      customerName: String(body?.customerName ?? ""),
      customerRef: typeof body?.customerRef === "string" ? body.customerRef : null,
      invoiceRef: typeof body?.invoiceRef === "string" ? body.invoiceRef : null,
      incomeAccountId: String(body?.incomeAccountId ?? ""),
      depositAccountId: String(body?.depositAccountId ?? ""),
      amount: Number(body?.amount),
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ revenue }, { status: 201 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
