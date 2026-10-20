import { NextRequest, NextResponse } from "next/server";
import { requireLendingAdmin, lendingErrorResponse, getBankSummary, listLoans, listTransactions, setDefaultRate } from "@/lib/lending";

// Lending Bank overview: pool summary, every loan with progress, funds history.
export async function GET() {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const { companyId, userId } = auth.session;
  const [summary, loans, transactions] = await Promise.all([getBankSummary(companyId, userId), listLoans(companyId), listTransactions(companyId)]);
  return NextResponse.json({ summary, loans, transactions });
}

// { defaultInterestRate } — the rate new loans start with.
export async function PATCH(req: NextRequest) {
  const auth = await requireLendingAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    await setDefaultRate(auth.session.companyId, auth.session.userId, Number(body?.defaultInterestRate));
    return NextResponse.json({ summary: await getBankSummary(auth.session.companyId, auth.session.userId) });
  } catch (err) {
    return lendingErrorResponse(err);
  }
}
