// Enterprise Finance Workspace — company investments.
//
// Same discipline as RevenueService/ExpenseService: every money movement is
// ONE automatically-posted, balanced journal, so the ledger (and therefore
// the dashboard's balances) updates by construction:
//
//   Purchase:    Debit  Investments (asset)     Credit payment (cash/bank)
//   Withdrawal:  Debit  deposit (cash/bank)     Credit Investments (asset)
//
// currentValue is an admin-maintained valuation; gain/loss is COMPUTED for
// display (currentValue − purchaseValue) and never posted — keeping the
// books simple and the UI honest. Every mutation is audited before/after.
import { db } from "@/db";
import { financeAccounts, financeInvestments } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { FinanceError, isValidDateString, toCents, toMoneyString } from "./types";
import { getAccount } from "./accounts";
import { createAndPost } from "./journal";

// The Investments asset account every posting targets — find-or-create with
// a stable system code, idempotent under the (company, code) unique index.
export const INVESTMENTS_ACCOUNT_CODE = "1500";

export async function ensureInvestmentsAccount(companyId: string): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.companyId, companyId), eq(financeAccounts.code, INVESTMENTS_ACCOUNT_CODE)))
    .limit(1);
  if (existing) return existing;
  await db
    .insert(financeAccounts)
    .values({ companyId, code: INVESTMENTS_ACCOUNT_CODE, name: "Investments", type: "asset", isSystem: true })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.companyId, companyId), eq(financeAccounts.code, INVESTMENTS_ACCOUNT_CODE)))
    .limit(1);
  if (!row) throw new FinanceError("Could not prepare the Investments account");
  return row;
}

export async function listInvestments(companyId: string) {
  const rows = await db
    .select()
    .from(financeInvestments)
    .where(eq(financeInvestments.companyId, companyId))
    .orderBy(desc(financeInvestments.purchaseDate), desc(financeInvestments.createdAt));
  return rows.map((r) => ({
    ...r,
    // Gains/losses, calculated — never stored, so they can't drift.
    gainLossCents: toCents(Number(r.currentValue)) - toCents(Number(r.purchaseValue)),
  }));
}

export interface CreateInvestmentInput {
  name: string;
  category?: string | null;
  purchaseDate: string;
  purchaseValue: number;
  paymentAccountId: string;
  notes?: string | null;
}

export async function createInvestment(companyId: string, actorUserId: string, input: CreateInvestmentInput) {
  if (!input.name?.trim()) throw new FinanceError("Name is required");
  if (!isValidDateString(input.purchaseDate)) throw new FinanceError("A valid purchase date is required");
  const cents = toCents(input.purchaseValue);
  if (cents <= 0) throw new FinanceError("Purchase value must be greater than zero");

  const payment = await getAccount(companyId, input.paymentAccountId);
  if (!payment || payment.type !== "asset" || !payment.subtype) {
    throw new FinanceError("Choose the cash or bank account the investment was paid from");
  }
  const invAccount = await ensureInvestmentsAccount(companyId);

  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: input.purchaseDate,
    memo: `Investment — ${input.name.trim()}`,
    sourceType: "investment",
    lines: [
      { accountId: invAccount.id, debit: cents / 100, description: input.name.trim() },
      { accountId: payment.id, credit: cents / 100, description: `Investment purchase — ${input.name.trim()}` },
    ],
  });

  const [row] = await db
    .insert(financeInvestments)
    .values({
      companyId,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      purchaseDate: input.purchaseDate,
      purchaseValue: toMoneyString(cents),
      currentValue: toMoneyString(cents),
      paymentAccountId: payment.id,
      journalId: journal.id,
      notes: input.notes?.trim() || null,
      createdBy: actorUserId,
    })
    .returning();

  await recordAudit({
    companyId,
    userId: actorUserId,
    action: "finance.investment_created",
    entityType: "finance_investment",
    entityId: row.id,
    after: { name: row.name, category: row.category, purchaseDate: row.purchaseDate, purchaseValue: row.purchaseValue, journalId: journal.id },
  });
  return row;
}

export async function updateInvestment(
  companyId: string,
  actorUserId: string,
  id: string,
  patch: { name?: string; category?: string | null; currentValue?: number; notes?: string | null },
) {
  const [existing] = await db
    .select()
    .from(financeInvestments)
    .where(and(eq(financeInvestments.id, id), eq(financeInvestments.companyId, companyId)))
    .limit(1);
  if (!existing) throw new FinanceError("Investment not found", 404);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new FinanceError("Name is required");
    set.name = patch.name.trim();
  }
  if (patch.category !== undefined) set.category = patch.category?.trim() || null;
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (patch.currentValue !== undefined) {
    const cents = toCents(patch.currentValue);
    if (cents < 0) throw new FinanceError("Current value cannot be negative");
    set.currentValue = toMoneyString(cents);
  }

  const [row] = await db.update(financeInvestments).set(set).where(eq(financeInvestments.id, id)).returning();
  await recordAudit({
    companyId,
    userId: actorUserId,
    action: "finance.investment_updated",
    entityType: "finance_investment",
    entityId: id,
    before: { name: existing.name, category: existing.category, currentValue: existing.currentValue, notes: existing.notes },
    after: { name: row.name, category: row.category, currentValue: row.currentValue, notes: row.notes },
  });
  return row;
}

export async function withdrawInvestment(
  companyId: string,
  actorUserId: string,
  id: string,
  input: { amount: number; depositAccountId: string; date: string },
) {
  const [existing] = await db
    .select()
    .from(financeInvestments)
    .where(and(eq(financeInvestments.id, id), eq(financeInvestments.companyId, companyId)))
    .limit(1);
  if (!existing) throw new FinanceError("Investment not found", 404);
  if (existing.status === "withdrawn") throw new FinanceError("This investment is already withdrawn");
  if (!isValidDateString(input.date)) throw new FinanceError("A valid withdrawal date is required");
  const cents = toCents(input.amount);
  if (cents <= 0) throw new FinanceError("Withdrawal amount must be greater than zero");

  const deposit = await getAccount(companyId, input.depositAccountId);
  if (!deposit || deposit.type !== "asset" || !deposit.subtype) {
    throw new FinanceError("Choose the cash or bank account the money returns to");
  }
  const invAccount = await ensureInvestmentsAccount(companyId);

  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: input.date,
    memo: `Investment withdrawal — ${existing.name}`,
    sourceType: "investment",
    lines: [
      { accountId: deposit.id, debit: cents / 100, description: `Withdrawal — ${existing.name}` },
      { accountId: invAccount.id, credit: cents / 100, description: existing.name },
    ],
  });

  const [row] = await db
    .update(financeInvestments)
    .set({
      status: "withdrawn",
      withdrawnValue: toMoneyString(cents),
      withdrawnAt: new Date(),
      currentValue: toMoneyString(cents),
      withdrawalJournalId: journal.id,
      updatedAt: new Date(),
    })
    .where(eq(financeInvestments.id, id))
    .returning();

  await recordAudit({
    companyId,
    userId: actorUserId,
    action: "finance.investment_withdrawn",
    entityType: "finance_investment",
    entityId: id,
    before: { status: existing.status, currentValue: existing.currentValue },
    after: { status: "withdrawn", withdrawnValue: row.withdrawnValue, journalId: journal.id },
  });
  return row;
}
