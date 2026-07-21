import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { withdrawInvestment } from "@/lib/finance";
import { isUuid } from "@/lib/url";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:post");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const investment = await withdrawInvestment(auth.session.companyId, auth.session.userId, id, {
      amount: Number(body?.amount),
      depositAccountId: String(body?.depositAccountId ?? ""),
      date: String(body?.date ?? ""),
    });
    return NextResponse.json({ investment });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
