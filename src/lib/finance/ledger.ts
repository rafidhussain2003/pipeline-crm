// Phase 19 — LedgerService: READ-ONLY views over the immutable ledger (posted
// journal lines). Nothing here writes — the ledger has exactly one writer
// (JournalService) and no editor.
import { db } from "@/db";
import { financeAccounts, financeJournalLines, financeJournals } from "@/db/schema";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { isUuid } from "@/lib/url";
import { FinanceError, isValidDateString } from "./types";

export interface LedgerQuery {
  accountId: string;
  from?: string; // YYYY-MM-DD inclusive
  to?: string;
  limit?: number;
  offset?: number;
}

// One account's ledger: entries in date order with a running balance. The
// opening figure is the SUM of everything before `from`; each row's running
// balance is a SQL window sum over the whole window (not just the page), and
// the closing figure is an aggregate over the whole window — so a page at any
// offset shows the right balances, and "Closing" is the account's real
// balance even when the window has more entries than one page.
export async function getAccountLedger(companyId: string, q: LedgerQuery) {
  // Same discipline as getAccount(): a malformed id is "not found", never a
  // Postgres uuid-cast 500.
  if (!q.accountId || !isUuid(q.accountId)) throw new FinanceError("Account not found", 404);
  const [account] = await db
    .select({ id: financeAccounts.id, code: financeAccounts.code, name: financeAccounts.name, type: financeAccounts.type })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.id, q.accountId), eq(financeAccounts.companyId, companyId)))
    .limit(1);
  if (!account) throw new FinanceError("Account not found", 404);
  if (q.from && !isValidDateString(q.from)) throw new FinanceError("Invalid from date");
  if (q.to && !isValidDateString(q.to)) throw new FinanceError("Invalid to date");

  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const offset = Math.max(q.offset ?? 0, 0);
  const debitNormal = account.type === "asset" || account.type === "expense";

  const base = [eq(financeJournalLines.companyId, companyId), eq(financeJournalLines.accountId, q.accountId), eq(financeJournalLines.posted, true)];

  // Balance carried into the window (0 when unwindowed).
  let openingCents = 0;
  if (q.from) {
    const [prior] = await db
      .select({
        debit: sql<string>`coalesce(sum(${financeJournalLines.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${financeJournalLines.credit}), 0)`,
      })
      .from(financeJournalLines)
      .where(and(...base, sql`${financeJournalLines.entryDate} < ${q.from}`));
    const d = Math.round(Number(prior.debit) * 100);
    const c = Math.round(Number(prior.credit) * 100);
    openingCents = debitNormal ? d - c : c - d;
  }

  const where = and(
    ...base,
    ...(q.from ? [gte(financeJournalLines.entryDate, q.from)] : []),
    ...(q.to ? [lte(financeJournalLines.entryDate, q.to)] : []),
  );

  // Signed movement of one line on this account's normal side.
  const signed = debitNormal
    ? sql`(${financeJournalLines.debit} - ${financeJournalLines.credit})`
    : sql`(${financeJournalLines.credit} - ${financeJournalLines.debit})`;

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: financeJournalLines.id,
        entryDate: financeJournalLines.entryDate,
        debit: financeJournalLines.debit,
        credit: financeJournalLines.credit,
        description: financeJournalLines.description,
        journalId: financeJournalLines.journalId,
        entryNumber: financeJournals.entryNumber,
        memo: financeJournals.memo,
        journalStatus: financeJournals.status,
        sourceType: financeJournals.sourceType,
        // Cumulative movement up to and including this row, over the WHOLE
        // window in ledger order — correct on every page.
        cumulative: sql<string>`sum(${signed}) over (order by ${financeJournalLines.entryDate}, ${financeJournals.entryNumber}, ${financeJournalLines.lineNo} rows unbounded preceding)`,
      })
      .from(financeJournalLines)
      .innerJoin(financeJournals, eq(financeJournals.id, financeJournalLines.journalId))
      .where(where)
      .orderBy(asc(financeJournalLines.entryDate), asc(financeJournals.entryNumber), asc(financeJournalLines.lineNo))
      .limit(limit)
      .offset(offset),
    db
      .select({ movement: sql<string>`coalesce(sum(${signed}), 0)`, count: sql<number>`count(*)::int` })
      .from(financeJournalLines)
      .innerJoin(financeJournals, eq(financeJournals.id, financeJournalLines.journalId))
      .where(where),
  ]);

  const entries = rows.map(({ cumulative, ...r }) => ({ ...r, runningBalanceCents: openingCents + Math.round(Number(cumulative) * 100) }));
  const total = Number(totals?.count ?? 0);
  return {
    account,
    openingCents,
    entries,
    closingCents: openingCents + Math.round(Number(totals?.movement ?? 0) * 100),
    total,
    offset,
    hasMore: offset + rows.length < total,
  };
}

// The module-wide integrity invariant: over ALL posted lines of a company,
// total debits must equal total credits — the definition of a sound
// double-entry ledger. Exposed for the dashboard/tests/health checks.
export async function ledgerIntegrity(companyId: string): Promise<{ debitCents: number; creditCents: number; balanced: boolean }> {
  const [sums] = await db
    .select({
      debit: sql<string>`coalesce(sum(${financeJournalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${financeJournalLines.credit}), 0)`,
    })
    .from(financeJournalLines)
    .where(and(eq(financeJournalLines.companyId, companyId), eq(financeJournalLines.posted, true)));
  const debitCents = Math.round(Number(sums.debit) * 100);
  const creditCents = Math.round(Number(sums.credit) * 100);
  return { debitCents, creditCents, balanced: debitCents === creditCents };
}

// ── Reporting placeholders (architecture only — Phase 19 builds NO reports).
// A future Reports phase implements each compute() against the same immutable
// ledger; registering here is what makes them appear. Deliberately mirrors the
// feature-registry pattern.
export interface FinanceReportDef {
  key: string;
  label: string;
  implemented: boolean;
}
export const FINANCE_REPORTS: readonly FinanceReportDef[] = [
  { key: "profit_loss", label: "Profit & Loss", implemented: false },
  { key: "balance_sheet", label: "Balance Sheet", implemented: false },
  { key: "trial_balance", label: "Trial Balance", implemented: false },
  { key: "cash_flow", label: "Cash Flow", implemented: false },
  { key: "tax", label: "Tax Reports", implemented: false },
] as const;
