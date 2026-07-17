import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { ensureFinanceSetup, listAccounts, createAccount, getAccountBalances } from "@/lib/finance";

// Chart of Accounts. GET seeds the system chart on first access (idempotent)
// and returns every account with its sign-normalized ledger balance in cents.
export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const companyId = auth.session.companyId;
  await ensureFinanceSetup(companyId);
  const [accounts, balances] = await Promise.all([listAccounts(companyId), getAccountBalances(companyId)]);
  return NextResponse.json({
    accounts: accounts.map((a) => ({ ...a, balanceCents: balances.get(a.id) ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const account = await createAccount(auth.session.companyId, auth.session.userId, {
      code: String(body?.code ?? ""),
      name: String(body?.name ?? ""),
      type: body?.type,
      subtype: body?.subtype ?? null,
      parentId: body?.parentId || null,
      description: typeof body?.description === "string" ? body.description : null,
      metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : null,
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
