// Phase 19 — Opening balances. Each account's opening balance is posted as an
// "opening_balance" journal against the Opening Balance Equity system account
// (3900) — standard practice that keeps the ledger the ONLY source of truth
// (no separate opening-balance column to drift out of sync).
//
// Lifecycle: while UNLOCKED an admin can set/replace an account's opening
// balance (replace = void the old opening journal + post a new one). CONFIRM
// locks them permanently: from then on no opening journal can be created or
// voided — corrections are ordinary adjusting entries, like any real book.
import { db } from "@/db";
import { financeAccounts, financeJournals, financeSettings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { FinanceError, isValidDateString, toCents, DEBIT_NORMAL, type AccountType } from "./types";
import { OPENING_EQUITY_CODE, ensureFinanceSetup, getAccount } from "./accounts";
import { createAndPost, voidJournal } from "./journal";

export async function getOpeningState(companyId: string) {
  await ensureFinanceSetup(companyId);
  const [settings] = await db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  const journals = await db
    .select({ id: financeJournals.id, sourceId: financeJournals.sourceId, status: financeJournals.status, entryDate: financeJournals.entryDate })
    .from(financeJournals)
    .where(and(eq(financeJournals.companyId, companyId), eq(financeJournals.sourceType, "opening_balance")));
  return {
    locked: !!settings?.openingBalancesLockedAt,
    lockedAt: settings?.openingBalancesLockedAt ?? null,
    // sourceId of an opening journal = the account it opens.
    openingJournalByAccount: new Map(journals.filter((j) => j.status === "posted" && j.sourceId).map((j) => [j.sourceId as string, j.id])),
  };
}

// Set (or replace) ONE account's opening balance. Positive amount = the
// account's natural side (a 500 cash opening debits cash; a 300 loan opening
// credits the liability), balanced against Opening Balance Equity.
export async function setOpeningBalance(
  companyId: string,
  actorUserId: string,
  input: { accountId: string; amount: number; asOfDate: string },
) {
  if (!isValidDateString(input.asOfDate)) throw new FinanceError("A valid as-of date is required");
  const cents = toCents(input.amount);
  if (cents <= 0) throw new FinanceError("Opening balance must be greater than zero (omit accounts that start at zero)");

  const state = await getOpeningState(companyId);
  if (state.locked) throw new FinanceError("Opening balances are locked. Post an adjusting journal entry instead.");

  const account = await getAccount(companyId, input.accountId);
  if (!account) throw new FinanceError("Account not found", 404);
  const [obe] = await db
    .select()
    .from(financeAccounts)
    .where(and(eq(financeAccounts.companyId, companyId), eq(financeAccounts.code, OPENING_EQUITY_CODE)))
    .limit(1);
  if (!obe) throw new FinanceError("Opening Balance Equity account is missing", 500);
  if (account.id === obe.id) throw new FinanceError("Opening Balance Equity cannot itself be opened");

  // Replace an existing opening for this account by voiding it first.
  const existing = state.openingJournalByAccount.get(account.id);
  if (existing) await voidJournal(companyId, actorUserId, existing, "Opening balance replaced");

  const debitNormal = DEBIT_NORMAL[account.type as AccountType];
  const amount = cents / 100;
  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: input.asOfDate,
    memo: `Opening balance — ${account.code} ${account.name}`,
    sourceType: "opening_balance",
    sourceId: account.id,
    lines: debitNormal
      ? [
          { accountId: account.id, debit: amount, description: "Opening balance" },
          { accountId: obe.id, credit: amount, description: `Opening — ${account.code}` },
        ]
      : [
          { accountId: account.id, credit: amount, description: "Opening balance" },
          { accountId: obe.id, debit: amount, description: `Opening — ${account.code}` },
        ],
  });

  await recordAudit({ companyId, userId: actorUserId, action: "finance.opening_balance_set", entityType: "finance_account", entityId: account.id, after: { amount, asOfDate: input.asOfDate, journalId: journal.id } });
  return journal;
}

// Confirm = permanent lock, audited. JournalService's void path also consults
// this via guardOpeningVoid below.
export async function confirmOpeningBalances(companyId: string, actorUserId: string) {
  const state = await getOpeningState(companyId);
  if (state.locked) throw new FinanceError("Opening balances are already locked");
  await db.update(financeSettings).set({ openingBalancesLockedAt: new Date(), updatedAt: new Date() }).where(eq(financeSettings.companyId, companyId));
  await recordAudit({ companyId, userId: actorUserId, action: "finance.opening_balances_locked", entityType: "finance_settings", entityId: companyId, after: { openings: state.openingJournalByAccount.size } });
  return { locked: true };
}

// Called by the void API path: a locked opening journal may not be voided.
export async function guardOpeningVoid(companyId: string, journalId: string): Promise<void> {
  const [journal] = await db
    .select({ sourceType: financeJournals.sourceType })
    .from(financeJournals)
    .where(and(eq(financeJournals.id, journalId), eq(financeJournals.companyId, companyId)))
    .limit(1);
  if (journal?.sourceType !== "opening_balance") return;
  const [settings] = await db.select({ locked: financeSettings.openingBalancesLockedAt }).from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1);
  if (settings?.locked) throw new FinanceError("Opening balances are locked — this entry cannot be voided. Post an adjusting entry instead.");
}
