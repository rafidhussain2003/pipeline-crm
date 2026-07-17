import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { getAccountLedger } from "@/lib/finance";

// The General Ledger view for one account: entries + running balance.
export async function GET(req: NextRequest) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const accountId = p.get("accountId");
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  try {
    const ledger = await getAccountLedger(auth.session.companyId, {
      accountId,
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
      limit: Number(p.get("limit")) || 100,
      offset: Number(p.get("offset")) || 0,
    });
    return NextResponse.json(ledger);
  } catch (err) {
    return financeErrorResponse(err);
  }
}
