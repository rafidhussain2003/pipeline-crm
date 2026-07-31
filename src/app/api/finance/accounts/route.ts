import { NextRequest, NextResponse } from "next/server";
import { requireFinance, getFinanceCapabilities, financeErrorResponse } from "@/lib/finance/guard";
import { ensureFinanceSetup, listAccounts, createAccount, getAccountBalances } from "@/lib/finance";

// Chart of Accounts. GET seeds the system chart on first access (idempotent)
// and returns every account; the per-account ledger balance is included ONLY
// for callers with view_balances (admins/managers always; a Finance Employee
// only if granted). The account list itself is needed for the entry-form
// dropdowns, so it stays visible to anyone with any Finance capability.
export async function GET() {
  const auth = await getFinanceCapabilities();
  if (!auth.ok) return auth.response;
  if (auth.caps.size === 0) return NextResponse.json({ error: "You do not have access to Finance" }, { status: 403 });
  const companyId = auth.session.companyId;
  await ensureFinanceSetup(companyId);
  const showBalances = auth.caps.has("view_balances");
  const [accounts, balances] = await Promise.all([
    listAccounts(companyId),
    showBalances ? getAccountBalances(companyId) : Promise.resolve(new Map<string, number>()),
  ]);
  return NextResponse.json({
    accounts: accounts.map((a) => ({ ...a, balanceCents: showBalances ? balances.get(a.id) ?? 0 : null })),
    canViewBalances: showBalances,
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
