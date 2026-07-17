import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { createExpense, listExpenses } from "@/lib/finance";

export async function GET(req: NextRequest) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const expenses = await listExpenses(auth.session.companyId, { limit: Number(p.get("limit")) || 50, offset: Number(p.get("offset")) || 0 });
  return NextResponse.json({ expenses });
}

// Record an expense — posts its balanced journal automatically.
export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const expense = await createExpense(auth.session.companyId, auth.session.userId, {
      entryDate: String(body?.entryDate ?? ""),
      vendorName: String(body?.vendorName ?? ""),
      category: typeof body?.category === "string" ? body.category : null,
      paymentMethod: String(body?.paymentMethod ?? "cash"),
      receiptRef: typeof body?.receiptRef === "string" ? body.receiptRef : null,
      expenseAccountId: String(body?.expenseAccountId ?? ""),
      paymentAccountId: String(body?.paymentAccountId ?? ""),
      amount: Number(body?.amount),
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
