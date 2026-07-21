import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { ensureFinanceSetup, listInvestments, createInvestment } from "@/lib/finance";

export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  await ensureFinanceSetup(auth.session.companyId);
  const investments = await listInvestments(auth.session.companyId);
  return NextResponse.json({ investments });
}

export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  await ensureFinanceSetup(auth.session.companyId);
  const body = await req.json().catch(() => ({}));
  try {
    const investment = await createInvestment(auth.session.companyId, auth.session.userId, {
      name: String(body?.name ?? ""),
      category: typeof body?.category === "string" ? body.category : null,
      purchaseDate: String(body?.purchaseDate ?? ""),
      purchaseValue: Number(body?.purchaseValue),
      paymentAccountId: String(body?.paymentAccountId ?? ""),
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ investment }, { status: 201 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
