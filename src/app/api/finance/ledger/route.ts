import { NextRequest, NextResponse } from "next/server";
import { requireFinanceCapability, financeErrorResponse } from "@/lib/finance/guard";
import { getAccountLedger } from "@/lib/finance";

// The General Ledger view for one account: entries + running balance. This is
// full transaction history, so it needs view_reports (admins/managers hold it;
// a Finance Employee sees it only if the admin granted "View ledger & reports").
export async function GET(req: NextRequest) {
  const auth = await requireFinanceCapability("view_reports");
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
