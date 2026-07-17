import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { confirmOpeningBalances, getOpeningState, setOpeningBalance } from "@/lib/finance";

export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const state = await getOpeningState(auth.session.companyId);
  return NextResponse.json({
    locked: state.locked,
    lockedAt: state.lockedAt,
    openedAccountIds: [...state.openingJournalByAccount.keys()],
  });
}

// { action: "set", accountId, amount, asOfDate } — set/replace one account's
// opening balance (only while unlocked).
// { action: "confirm" } — lock opening balances permanently.
export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "set") {
      const journal = await setOpeningBalance(auth.session.companyId, auth.session.userId, {
        accountId: String(body?.accountId ?? ""),
        amount: Number(body?.amount),
        asOfDate: String(body?.asOfDate ?? ""),
      });
      return NextResponse.json({ journalId: journal.id });
    }
    if (body?.action === "confirm") {
      const result = await confirmOpeningBalances(auth.session.companyId, auth.session.userId);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: 'action must be "set" or "confirm"' }, { status: 400 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
