import { NextResponse } from "next/server";
import { requireFinance } from "@/lib/finance/guard";
import { ensureFinanceSetup, listAccounts, getAccountBalances, listJournals, ledgerIntegrity, FINANCE_REPORTS } from "@/lib/finance";
import { db } from "@/db";
import { financeJournalLines, financeAccounts } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

// Finance dashboard: cash/bank totals, month-to-date income & expenses, the
// ledger integrity check, recent entries, and the report placeholders.
export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const companyId = auth.session.companyId;
  await ensureFinanceSetup(companyId);

  const [accounts, balances, recent, integrity] = await Promise.all([
    listAccounts(companyId),
    getAccountBalances(companyId),
    listJournals(companyId, { limit: 8 }),
    ledgerIntegrity(companyId),
  ]);

  let cashCents = 0, bankCents = 0;
  for (const a of accounts) {
    if (a.subtype === "cash") cashCents += balances.get(a.id) ?? 0;
    if (a.subtype === "bank") bankCents += balances.get(a.id) ?? 0;
  }

  // Month-to-date income/expense movement from the ledger, one grouped scan.
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const mtd = await db
    .select({
      type: financeAccounts.type,
      debit: sql<string>`coalesce(sum(${financeJournalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${financeJournalLines.credit}), 0)`,
    })
    .from(financeJournalLines)
    .innerJoin(financeAccounts, eq(financeAccounts.id, financeJournalLines.accountId))
    .where(and(eq(financeJournalLines.companyId, companyId), eq(financeJournalLines.posted, true), gte(financeJournalLines.entryDate, monthStart)))
    .groupBy(financeAccounts.type);

  let incomeMtdCents = 0, expenseMtdCents = 0;
  for (const r of mtd) {
    const d = Math.round(Number(r.debit) * 100);
    const c = Math.round(Number(r.credit) * 100);
    if (r.type === "income") incomeMtdCents += c - d;
    if (r.type === "expense") expenseMtdCents += d - c;
  }

  return NextResponse.json({
    cashCents,
    bankCents,
    incomeMtdCents,
    expenseMtdCents,
    netMtdCents: incomeMtdCents - expenseMtdCents,
    integrity,
    recent,
    reports: FINANCE_REPORTS, // placeholders — none implemented in Phase 19
  });
}
