// Phase 19 — RevenueService + ExpenseService. Each document is a thin,
// numbered wrapper around ONE automatically-posted journal:
//
//   Revenue:  Debit deposit (cash/bank)   Credit income account
//   Expense:  Debit expense account       Credit payment (cash/bank)
//
// Documents are never edited after creation (their journal is posted);
// corrections = void (reversing entry) + re-enter.
import { db } from "@/db";
import { financeExpenses, financeRevenues, financeSettings } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { FinanceError, PAYMENT_METHODS, isValidDateString, toCents, toMoneyString } from "./types";
import { ensureFinanceSetup, getAccount } from "./accounts";
import { createAndPost, voidJournal } from "./journal";

async function nextDocNumber(companyId: string, kind: "revenue" | "expense"): Promise<number> {
  const col = kind === "revenue" ? financeSettings.nextRevenueNumber : financeSettings.nextExpenseNumber;
  const rows = await db
    .update(financeSettings)
    .set(kind === "revenue" ? { nextRevenueNumber: sql`${col} + 1`, updatedAt: new Date() } : { nextExpenseNumber: sql`${col} + 1`, updatedAt: new Date() })
    .where(eq(financeSettings.companyId, companyId))
    .returning({ n: col });
  if (rows.length === 0) {
    await ensureFinanceSetup(companyId);
    return nextDocNumber(companyId, kind);
  }
  return rows[0].n - 1;
}

// ── Revenue ─────────────────────────────────────────────────────────────────
export interface CreateRevenueInput {
  entryDate: string;
  customerName: string;
  customerRef?: string | null;
  invoiceRef?: string | null;
  incomeAccountId: string;
  depositAccountId: string;
  amount: number;
  notes?: string | null;
}

export async function createRevenue(companyId: string, actorUserId: string, input: CreateRevenueInput) {
  if (!isValidDateString(input.entryDate)) throw new FinanceError("A valid date is required");
  if (!input.customerName?.trim()) throw new FinanceError("Customer is required");
  const cents = toCents(input.amount);
  if (cents <= 0) throw new FinanceError("Amount must be greater than zero");

  const income = await getAccount(companyId, input.incomeAccountId);
  if (!income || income.type !== "income") throw new FinanceError("Choose an income account");
  const deposit = await getAccount(companyId, input.depositAccountId);
  if (!deposit || deposit.type !== "asset") throw new FinanceError("Choose the cash or bank account the money was received into");

  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: input.entryDate,
    memo: `Revenue — ${input.customerName.trim()}`,
    sourceType: "revenue",
    lines: [
      { accountId: deposit.id, debit: cents / 100, description: `Received from ${input.customerName.trim()}` },
      { accountId: income.id, credit: cents / 100, description: input.notes?.trim() || null },
    ],
  });

  const docNumber = await nextDocNumber(companyId, "revenue");
  const [row] = await db
    .insert(financeRevenues)
    .values({
      companyId,
      docNumber,
      entryDate: input.entryDate,
      customerName: input.customerName.trim(),
      customerRef: input.customerRef?.trim() || null,
      invoiceRef: input.invoiceRef?.trim() || null,
      incomeAccountId: income.id,
      depositAccountId: deposit.id,
      amount: toMoneyString(cents),
      notes: input.notes?.trim() || null,
      journalId: journal.id,
      createdBy: actorUserId,
    })
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "finance.revenue_created", entityType: "finance_revenue", entityId: row.id, after: { docNumber, amount: row.amount, customer: row.customerName, journalId: journal.id } });
  return row;
}

export async function voidRevenue(companyId: string, actorUserId: string, revenueId: string, reason?: string) {
  const [doc] = await db.select().from(financeRevenues).where(and(eq(financeRevenues.id, revenueId), eq(financeRevenues.companyId, companyId))).limit(1);
  if (!doc) throw new FinanceError("Revenue entry not found", 404);
  if (doc.status === "voided") throw new FinanceError("This revenue entry is already voided");

  await voidJournal(companyId, actorUserId, doc.journalId, reason || `Void revenue #${doc.docNumber}`);
  const [row] = await db.update(financeRevenues).set({ status: "voided", voidReason: reason ?? null, updatedAt: new Date() }).where(eq(financeRevenues.id, revenueId)).returning();
  await recordAudit({ companyId, userId: actorUserId, action: "finance.revenue_voided", entityType: "finance_revenue", entityId: revenueId, after: { reason: reason ?? null } });
  return row;
}

export async function listRevenues(companyId: string, opts: { limit?: number; offset?: number } = {}) {
  return db
    .select()
    .from(financeRevenues)
    .where(eq(financeRevenues.companyId, companyId))
    .orderBy(desc(financeRevenues.entryDate), desc(financeRevenues.docNumber))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}

// ── Expenses ────────────────────────────────────────────────────────────────
export interface CreateExpenseInput {
  entryDate: string;
  vendorName: string;
  category?: string | null;
  paymentMethod: string;
  receiptRef?: string | null;
  expenseAccountId: string;
  paymentAccountId: string;
  amount: number;
  notes?: string | null;
}

export async function createExpense(companyId: string, actorUserId: string, input: CreateExpenseInput) {
  if (!isValidDateString(input.entryDate)) throw new FinanceError("A valid date is required");
  if (!input.vendorName?.trim()) throw new FinanceError("Vendor is required");
  if (!PAYMENT_METHODS.includes(input.paymentMethod as (typeof PAYMENT_METHODS)[number])) throw new FinanceError("Invalid payment method");
  const cents = toCents(input.amount);
  if (cents <= 0) throw new FinanceError("Amount must be greater than zero");

  const expense = await getAccount(companyId, input.expenseAccountId);
  if (!expense || expense.type !== "expense") throw new FinanceError("Choose an expense account");
  const payment = await getAccount(companyId, input.paymentAccountId);
  if (!payment || payment.type !== "asset") throw new FinanceError("Choose the cash or bank account that paid this");

  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: input.entryDate,
    memo: `Expense — ${input.vendorName.trim()}`,
    sourceType: "expense",
    lines: [
      { accountId: expense.id, debit: cents / 100, description: input.category?.trim() || null },
      { accountId: payment.id, credit: cents / 100, description: `Paid to ${input.vendorName.trim()}` },
    ],
  });

  const docNumber = await nextDocNumber(companyId, "expense");
  const [row] = await db
    .insert(financeExpenses)
    .values({
      companyId,
      docNumber,
      entryDate: input.entryDate,
      vendorName: input.vendorName.trim(),
      category: input.category?.trim() || null,
      paymentMethod: input.paymentMethod,
      receiptRef: input.receiptRef?.trim() || null,
      expenseAccountId: expense.id,
      paymentAccountId: payment.id,
      amount: toMoneyString(cents),
      notes: input.notes?.trim() || null,
      journalId: journal.id,
      createdBy: actorUserId,
    })
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "finance.expense_created", entityType: "finance_expense", entityId: row.id, after: { docNumber, amount: row.amount, vendor: row.vendorName, journalId: journal.id } });
  return row;
}

export async function voidExpense(companyId: string, actorUserId: string, expenseId: string, reason?: string) {
  const [doc] = await db.select().from(financeExpenses).where(and(eq(financeExpenses.id, expenseId), eq(financeExpenses.companyId, companyId))).limit(1);
  if (!doc) throw new FinanceError("Expense entry not found", 404);
  if (doc.status === "voided") throw new FinanceError("This expense is already voided");

  await voidJournal(companyId, actorUserId, doc.journalId, reason || `Void expense #${doc.docNumber}`);
  const [row] = await db.update(financeExpenses).set({ status: "voided", voidReason: reason ?? null, updatedAt: new Date() }).where(eq(financeExpenses.id, expenseId)).returning();
  await recordAudit({ companyId, userId: actorUserId, action: "finance.expense_voided", entityType: "finance_expense", entityId: expenseId, after: { reason: reason ?? null } });
  return row;
}

export async function listExpenses(companyId: string, opts: { limit?: number; offset?: number } = {}) {
  return db
    .select()
    .from(financeExpenses)
    .where(eq(financeExpenses.companyId, companyId))
    .orderBy(desc(financeExpenses.entryDate), desc(financeExpenses.docNumber))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}
