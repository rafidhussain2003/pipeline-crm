// Phase 19 — RevenueService + ExpenseService. Each document is a thin,
// numbered wrapper around ONE automatically-posted journal:
//
//   Revenue:  Debit deposit (cash/bank)   Credit income account
//   Expense:  Debit expense account       Credit payment (cash/bank)
//
// Documents are never edited after creation (their journal is posted);
// corrections = void (reversing entry) + re-enter.
import { db } from "@/db";
import { financeAccounts, financeClients, financeExpenses, financeRevenues, financeSettings } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { FinanceError, PAYMENT_METHODS, isValidDateString, toCents, toMoneyString } from "./types";
import { ensureFinanceSetup, getAccount } from "./accounts";
import { createAndPost, voidJournal } from "./journal";
import { getClient } from "./clients";

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

// ── Invoice numbering ────────────────────────────────────────────────────────
// Indian financial year (April–March) label for a calendar date: "2026-27".
export function financialYearLabel(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// Allocates the next invoice number for the FY of `invoiceDate` in ONE atomic
// statement: the counter continues inside the same FY and restarts at 1 when
// the FY changes. Returns e.g. "INV/2026-27/003".
async function nextInvoiceNumber(companyId: string, invoiceDate: string): Promise<string> {
  const fy = financialYearLabel(invoiceDate);
  const rows = await db
    .update(financeSettings)
    .set({
      nextInvoiceNumber: sql`CASE WHEN ${financeSettings.invoiceNumberFy} = ${fy} THEN ${financeSettings.nextInvoiceNumber} + 1 ELSE 2 END`,
      invoiceNumberFy: fy,
      updatedAt: new Date(),
    })
    .where(eq(financeSettings.companyId, companyId))
    .returning({ n: financeSettings.nextInvoiceNumber, prefix: financeSettings.invoiceNumberPrefix });
  if (rows.length === 0) {
    await ensureFinanceSetup(companyId);
    return nextInvoiceNumber(companyId, invoiceDate);
  }
  return `${rows[0].prefix || "INV"}/${fy}/${String(rows[0].n - 1).padStart(3, "0")}`;
}

// ── Revenue ─────────────────────────────────────────────────────────────────
export interface CreateRevenueInput {
  entryDate: string; // payment received date
  customerName?: string | null; // legacy free-text; ignored when clientId is given
  customerRef?: string | null;
  invoiceRef?: string | null;
  incomeAccountId: string;
  depositAccountId: string;
  amount: number; // base-currency amount received (what posts to the books)
  notes?: string | null;
  // Invoicing — all required together when clientId is given.
  clientId?: string | null;
  invoiceDate?: string | null;
  servicePeriod?: string | null; // "July 2026"
  serviceDescription?: string | null; // "BPO Services for July 2026"
  invoiceCurrency?: string | null; // "USD"
  invoiceAmount?: number | null; // 104.00 in invoiceCurrency
}

export async function createRevenue(companyId: string, actorUserId: string, input: CreateRevenueInput) {
  if (!isValidDateString(input.entryDate)) throw new FinanceError("A valid date is required");
  const cents = toCents(input.amount);
  if (cents <= 0) throw new FinanceError("Amount must be greater than zero");

  // Client + invoice details. With a client the customer name is the client's
  // legal name and an invoice is generated at posting.
  let customerName = input.customerName?.trim() || "";
  let invoice: { clientId: string; invoiceDate: string; servicePeriod: string; serviceDescription: string; invoiceCurrency: string; invoiceAmount: string } | null = null;
  if (input.clientId) {
    const client = await getClient(companyId, input.clientId);
    if (!client) throw new FinanceError("Choose a client");
    customerName = client.name;
    const invoiceDate = input.invoiceDate || input.entryDate;
    if (!isValidDateString(invoiceDate)) throw new FinanceError("A valid invoice date is required");
    const servicePeriod = input.servicePeriod?.trim() || "";
    if (!servicePeriod) throw new FinanceError("Service period is required (e.g. July 2026)");
    const serviceDescription = input.serviceDescription?.trim() || `${client.serviceDescription} for ${servicePeriod}`;
    const invoiceCurrency = (input.invoiceCurrency?.trim() || client.invoiceCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(invoiceCurrency)) throw new FinanceError("Invoice currency must be a 3-letter code");
    const invoiceCents = toCents(input.invoiceAmount ?? input.amount);
    if (invoiceCents <= 0) throw new FinanceError("Invoice amount must be greater than zero");
    invoice = { clientId: client.id, invoiceDate, servicePeriod, serviceDescription: serviceDescription.slice(0, 200), invoiceCurrency, invoiceAmount: toMoneyString(invoiceCents) };
  }
  if (!customerName) throw new FinanceError("Choose a client");
  input = { ...input, customerName };

  const income = await getAccount(companyId, input.incomeAccountId);
  if (!income || income.type !== "income") throw new FinanceError("Choose an income account");
  const deposit = await getAccount(companyId, input.depositAccountId);
  if (!deposit || deposit.type !== "asset") throw new FinanceError("Choose the cash or bank account the money was received into");

  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: input.entryDate,
    memo: `Revenue — ${customerName}`,
    sourceType: "revenue",
    lines: [
      { accountId: deposit.id, debit: cents / 100, description: `Received from ${customerName}` },
      { accountId: income.id, credit: cents / 100, description: input.notes?.trim() || null },
    ],
  });

  const docNumber = await nextDocNumber(companyId, "revenue");
  const invoiceNumber = invoice ? await nextInvoiceNumber(companyId, invoice.invoiceDate) : null;
  const [row] = await db
    .insert(financeRevenues)
    .values({
      companyId,
      docNumber,
      entryDate: input.entryDate,
      customerName,
      customerRef: input.customerRef?.trim() || null,
      invoiceRef: invoiceNumber ?? (input.invoiceRef?.trim() || null),
      ...(invoice ? { ...invoice, invoiceNumber } : {}),
      incomeAccountId: income.id,
      depositAccountId: deposit.id,
      amount: toMoneyString(cents),
      notes: input.notes?.trim() || null,
      journalId: journal.id,
      createdBy: actorUserId,
    })
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "finance.revenue_created", entityType: "finance_revenue", entityId: row.id, after: { docNumber, amount: row.amount, customer: row.customerName, invoiceNumber, journalId: journal.id } });
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

// A 'YYYY-MM' month narrows the list to that calendar month (entry_date).
export async function listRevenues(companyId: string, opts: { limit?: number; offset?: number; month?: string | null } = {}) {
  return db
    .select()
    .from(financeRevenues)
    .where(and(eq(financeRevenues.companyId, companyId), opts.month ? sql`to_char(${financeRevenues.entryDate}, 'YYYY-MM') = ${opts.month}` : undefined))
    .orderBy(desc(financeRevenues.entryDate), desc(financeRevenues.docNumber))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}

// ── Expenses ────────────────────────────────────────────────────────────────
// The money-out document kind. All post the same journal shape; the type only
// labels the document and drives the per-capability gate (record_expense vs
// record_payout).
export const EXPENSE_DOC_TYPES = ["expense", "payout", "salary"] as const;
export type ExpenseDocType = (typeof EXPENSE_DOC_TYPES)[number];
const DOC_TYPE_LABEL: Record<ExpenseDocType, string> = {
  expense: "Expense",
  payout: "Customer payout",
  salary: "Salary payment",
};

export interface CreateExpenseInput {
  entryDate: string;
  vendorName: string;
  category?: string | null;
  docType?: string | null;
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

  const docType: ExpenseDocType = (EXPENSE_DOC_TYPES as readonly string[]).includes(input.docType ?? "")
    ? (input.docType as ExpenseDocType)
    : "expense";

  const expense = await getAccount(companyId, input.expenseAccountId);
  if (!expense || expense.type !== "expense") throw new FinanceError("Choose an expense account");
  const payment = await getAccount(companyId, input.paymentAccountId);
  if (!payment || payment.type !== "asset") throw new FinanceError("Choose the cash or bank account that paid this");

  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: input.entryDate,
    memo: `${DOC_TYPE_LABEL[docType]} — ${input.vendorName.trim()}`,
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
      docType,
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

export async function listExpenses(companyId: string, opts: { limit?: number; offset?: number; month?: string | null } = {}) {
  return db
    .select()
    .from(financeExpenses)
    .where(and(eq(financeExpenses.companyId, companyId), opts.month ? sql`to_char(${financeExpenses.entryDate}, 'YYYY-MM') = ${opts.month}` : undefined))
    .orderBy(desc(financeExpenses.entryDate), desc(financeExpenses.docNumber))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}

// ── Monthly summaries ────────────────────────────────────────────────────────
// Per-calendar-month totals computed IN THE DATABASE over every POSTED document
// (voided excluded), so the figures are exact no matter how many rows the list
// endpoints page through. Grouped by month + classification in ONE query and
// folded here, newest month first.
type Bucket = { label: string; total: number; count: number };
const round2 = (n: number) => Math.round(n * 100) / 100;
function foldBuckets(items: { label: string; total: number; count: number }[]): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const it of items) {
    const b = m.get(it.label) ?? { label: it.label, total: 0, count: 0 };
    b.total = round2(b.total + it.total);
    b.count += it.count;
    m.set(it.label, b);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

export type RevenueMonthSummary = { month: string; total: number; count: number; byAccount: Bucket[] };
export async function revenueMonthlySummary(companyId: string): Promise<RevenueMonthSummary[]> {
  const month = sql<string>`to_char(${financeRevenues.entryDate}, 'YYYY-MM')`;
  const rows = await db
    .select({ month, account: financeAccounts.name, total: sql<string>`sum(${financeRevenues.amount})`, count: sql<number>`count(*)::int` })
    .from(financeRevenues)
    .innerJoin(financeAccounts, eq(financeAccounts.id, financeRevenues.incomeAccountId))
    .where(and(eq(financeRevenues.companyId, companyId), eq(financeRevenues.status, "posted")))
    .groupBy(month, financeAccounts.name);
  const byMonth = new Map<string, { total: number; count: number; items: Bucket[] }>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { total: 0, count: 0, items: [] };
    const t = Number(r.total) || 0;
    m.total = round2(m.total + t);
    m.count += Number(r.count) || 0;
    m.items.push({ label: r.account, total: round2(t), count: Number(r.count) || 0 });
    byMonth.set(r.month, m);
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mo, m]) => ({ month: mo, total: m.total, count: m.count, byAccount: foldBuckets(m.items) }));
}

export type ExpenseMonthSummary = { month: string; total: number; count: number; byCategory: Bucket[]; byMethod: Bucket[]; byType: Bucket[] };
export async function expenseMonthlySummary(companyId: string): Promise<ExpenseMonthSummary[]> {
  const month = sql<string>`to_char(${financeExpenses.entryDate}, 'YYYY-MM')`;
  const rows = await db
    .select({
      month,
      category: financeExpenses.category,
      method: financeExpenses.paymentMethod,
      docType: financeExpenses.docType,
      total: sql<string>`sum(${financeExpenses.amount})`,
      count: sql<number>`count(*)::int`,
    })
    .from(financeExpenses)
    .where(and(eq(financeExpenses.companyId, companyId), eq(financeExpenses.status, "posted")))
    .groupBy(month, financeExpenses.category, financeExpenses.paymentMethod, financeExpenses.docType);
  const byMonth = new Map<string, { total: number; count: number; cat: Bucket[]; method: Bucket[]; type: Bucket[] }>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { total: 0, count: 0, cat: [], method: [], type: [] };
    const t = round2(Number(r.total) || 0);
    const c = Number(r.count) || 0;
    m.total = round2(m.total + t);
    m.count += c;
    m.cat.push({ label: (r.category || "").trim() || "Uncategorized", total: t, count: c });
    m.method.push({ label: r.method || "other", total: t, count: c });
    m.type.push({ label: r.docType || "expense", total: t, count: c });
    byMonth.set(r.month, m);
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mo, m]) => ({ month: mo, total: m.total, count: m.count, byCategory: foldBuckets(m.cat), byMethod: foldBuckets(m.method), byType: foldBuckets(m.type) }));
}

// Everything the invoice PDF needs for one revenue entry (company-scoped).
export async function getRevenueForInvoice(companyId: string, revenueId: string) {
  const [[doc], [settings]] = await Promise.all([
    db.select().from(financeRevenues).where(and(eq(financeRevenues.id, revenueId), eq(financeRevenues.companyId, companyId))).limit(1),
    db.select().from(financeSettings).where(eq(financeSettings.companyId, companyId)).limit(1),
  ]);
  if (!doc) return null;
  const [client] = doc.clientId
    ? await db.select().from(financeClients).where(and(eq(financeClients.id, doc.clientId), eq(financeClients.companyId, companyId))).limit(1)
    : [];
  return { doc, client: client ?? null, settings: settings ?? null };
}
