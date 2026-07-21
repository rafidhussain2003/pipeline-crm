// Phase 19 — AccountService: the Chart of Accounts.
import { db } from "@/db";
import { financeAccounts, financeJournalLines, financeSettings } from "@/db/schema";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/url";
import { FinanceError, ACCOUNT_TYPES, type AccountType } from "./types";

// The default chart every company starts from. System accounts (isSystem) can
// be renamed/described but never deleted; the codes marked with a role below
// are load-bearing for the posting engine.
export const SYSTEM_ACCOUNTS: { code: string; name: string; type: AccountType; subtype?: "cash" | "bank"; role?: "opening_equity" | "retained_earnings" }[] = [
  { code: "1000", name: "Cash in Hand", type: "asset", subtype: "cash" },
  { code: "1010", name: "Petty Cash", type: "asset", subtype: "cash" },
  { code: "1100", name: "Primary Bank Account", type: "asset", subtype: "bank" },
  { code: "1200", name: "Accounts Receivable", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Taxes Payable", type: "liability" },
  { code: "3000", name: "Owner's Equity", type: "equity" },
  { code: "3900", name: "Opening Balance Equity", type: "equity", role: "opening_equity" },
  { code: "3950", name: "Retained Earnings", type: "equity", role: "retained_earnings" },
  { code: "4000", name: "Sales Revenue", type: "income" },
  { code: "4100", name: "Other Income", type: "income" },
  { code: "5000", name: "General Expenses", type: "expense" },
  { code: "5100", name: "Rent", type: "expense" },
  { code: "5200", name: "Salaries & Wages", type: "expense" }, // future Payroll posts here
  { code: "5300", name: "Utilities", type: "expense" },
];

export const OPENING_EQUITY_CODE = "3900";

// Idempotent per-company bootstrap: system accounts + the settings row.
// ON CONFLICT DO NOTHING on (companyId, code) makes concurrent first requests
// safe. Returns true when this call actually created the chart (first run).
export async function ensureFinanceSetup(companyId: string): Promise<boolean> {
  const inserted = await db
    .insert(financeAccounts)
    .values(SYSTEM_ACCOUNTS.map((a) => ({ companyId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null, isSystem: true })))
    .onConflictDoNothing()
    .returning({ id: financeAccounts.id });
  await db.insert(financeSettings).values({ companyId }).onConflictDoNothing();
  return inserted.length === SYSTEM_ACCOUNTS.length;
}

export interface CreateAccountInput {
  code: string;
  name: string;
  type: AccountType;
  subtype?: "cash" | "bank" | null;
  parentId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}

function validateCode(code: string) {
  if (!/^[0-9A-Za-z.\-]{1,20}$/.test(code)) throw new FinanceError("Account number must be 1-20 characters (digits, letters, dot, dash)");
}

export async function getAccount(companyId: string, accountId: string) {
  // A non-uuid id (an empty account <select>, a tampered request) must be
  // "not found" — previously it reached the uuid column, Postgres threw a
  // 22P02 cast error, and the user saw a bare 500 instead of the service's
  // clean "choose an account" message. Every finance flow that validates
  // accounts goes through here, so this closes the whole class.
  if (!accountId || !isUuid(accountId)) return null;
  const [row] = await db.select().from(financeAccounts).where(and(eq(financeAccounts.id, accountId), eq(financeAccounts.companyId, companyId))).limit(1);
  return row ?? null;
}

export async function listAccounts(companyId: string) {
  return db
    .select()
    .from(financeAccounts)
    .where(eq(financeAccounts.companyId, companyId))
    .orderBy(asc(financeAccounts.code));
}

export async function createAccount(companyId: string, actorUserId: string, input: CreateAccountInput) {
  validateCode(input.code);
  if (!input.name?.trim()) throw new FinanceError("Account name is required");
  if (!ACCOUNT_TYPES.includes(input.type)) throw new FinanceError("Invalid account type");
  if (input.subtype && input.subtype !== "cash" && input.subtype !== "bank") throw new FinanceError("Invalid subtype");
  if (input.subtype && input.type !== "asset") throw new FinanceError("Cash and bank accounts must be asset accounts");

  if (input.parentId) {
    const parent = await getAccount(companyId, input.parentId);
    if (!parent) throw new FinanceError("Parent account not found", 404);
    if (parent.type !== input.type) throw new FinanceError("A child account must have the same type as its parent");
  }

  try {
    const [row] = await db
      .insert(financeAccounts)
      .values({
        companyId,
        code: input.code.trim(),
        name: input.name.trim(),
        type: input.type,
        subtype: input.subtype ?? null,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();
    await recordAudit({ companyId, userId: actorUserId, action: "finance.account_created", entityType: "finance_account", entityId: row.id, after: { code: row.code, name: row.name, type: row.type, subtype: row.subtype } });
    return row;
  } catch (err) {
    // drizzle wraps the pg error: the constraint name lives on err.cause.
    const text = err instanceof Error ? `${err.message} ${(err.cause as Error | undefined)?.message ?? ""}` : "";
    if (/finance_accounts_company_code_uniq|duplicate key/.test(text)) {
      throw new FinanceError(`Account number "${input.code}" is already in use`);
    }
    throw err;
  }
}

export async function updateAccount(
  companyId: string,
  actorUserId: string,
  accountId: string,
  patch: { name?: string; description?: string | null; active?: boolean; parentId?: string | null; metadata?: Record<string, unknown> | null },
) {
  const account = await getAccount(companyId, accountId);
  if (!account) throw new FinanceError("Account not found", 404);
  if (account.isSystem && patch.active === false) throw new FinanceError("System accounts cannot be deactivated");
  if (patch.parentId) {
    if (patch.parentId === accountId) throw new FinanceError("An account cannot be its own parent");
    const parent = await getAccount(companyId, patch.parentId);
    if (!parent) throw new FinanceError("Parent account not found", 404);
    if (parent.type !== account.type) throw new FinanceError("A child account must have the same type as its parent");
  }

  const [row] = await db
    .update(financeAccounts)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(financeAccounts.id, accountId), eq(financeAccounts.companyId, companyId)))
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "finance.account_updated", entityType: "finance_account", entityId: accountId, before: { name: account.name, active: account.active }, after: patch });
  return row;
}

// Deletion rules: never a system account, never an account with ledger usage
// (any journal line, draft or posted), never one with children. The DB backs
// this with the lines FK, but the service gives the honest reason first.
export async function deleteAccount(companyId: string, actorUserId: string, accountId: string): Promise<void> {
  const account = await getAccount(companyId, accountId);
  if (!account) throw new FinanceError("Account not found", 404);
  if (account.isSystem) throw new FinanceError("System accounts cannot be deleted");

  const [usage] = await db.select({ n: count() }).from(financeJournalLines).where(eq(financeJournalLines.accountId, accountId));
  if (usage.n > 0) throw new FinanceError("This account has journal activity and cannot be deleted. Deactivate it instead.");
  const [children] = await db.select({ n: count() }).from(financeAccounts).where(eq(financeAccounts.parentId, accountId));
  if (children.n > 0) throw new FinanceError("This account has child accounts and cannot be deleted");

  await db.delete(financeAccounts).where(and(eq(financeAccounts.id, accountId), eq(financeAccounts.companyId, companyId)));
  await recordAudit({ companyId, userId: actorUserId, action: "finance.account_deleted", entityType: "finance_account", entityId: accountId, before: { code: account.code, name: account.name } });
}

// Balances for every account in one grouped scan of the posted ledger,
// signed by the account's normal side (asset/expense = debit-normal).
export async function getAccountBalances(companyId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountId: financeJournalLines.accountId,
      debit: sql<string>`coalesce(sum(${financeJournalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${financeJournalLines.credit}), 0)`,
    })
    .from(financeJournalLines)
    .where(and(eq(financeJournalLines.companyId, companyId), eq(financeJournalLines.posted, true)))
    .groupBy(financeJournalLines.accountId);

  const accounts = await listAccounts(companyId);
  const typeById = new Map(accounts.map((a) => [a.id, a.type]));
  const balances = new Map<string, number>(); // accountId -> cents, sign-normalized
  for (const r of rows) {
    const debitCents = Math.round(Number(r.debit) * 100);
    const creditCents = Math.round(Number(r.credit) * 100);
    const type = typeById.get(r.accountId);
    const debitNormal = type === "asset" || type === "expense";
    balances.set(r.accountId, debitNormal ? debitCents - creditCents : creditCents - debitCents);
  }
  return balances;
}
