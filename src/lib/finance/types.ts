// Phase 19 — Finance shared types + money helpers.
//
// MONEY DISCIPLINE: amounts cross the API as JS numbers, are validated to two
// decimal places, and every comparison/summation in the service layer happens
// in integer CENTS (never floating-point arithmetic on dollars). Postgres
// stores numeric(14,2) (exact) and drizzle surfaces it as a string — toCents()
// and toMoneyString() are the only two conversion points.

export class FinanceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

// Which side increases an account of this type — the sign convention every
// balance in the module uses. Assets/expenses grow with debits;
// liabilities/equity/income grow with credits.
export const DEBIT_NORMAL: Record<AccountType, boolean> = {
  asset: true,
  expense: true,
  liability: false,
  equity: false,
  income: false,
};

export type AccountSubtype = "cash" | "bank" | null;

export interface JournalLineInput {
  accountId: string;
  debit?: number; // dollars, 2dp
  credit?: number;
  description?: string | null;
}

export const PAYMENT_METHODS = ["cash", "bank", "card", "other"] as const;

// ── Money helpers ───────────────────────────────────────────────────────────
export function toCents(amount: unknown): number {
  const n = typeof amount === "string" ? Number(amount) : (amount as number);
  if (typeof n !== "number" || !Number.isFinite(n)) throw new FinanceError("Amount must be a number");
  const cents = Math.round(n * 100);
  // Reject sub-cent inputs (1.005) instead of silently rounding money.
  if (Math.abs(n * 100 - cents) > 1e-6) throw new FinanceError("Amounts can have at most 2 decimal places");
  return cents;
}

export function toMoneyString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// "YYYY-MM-DD" for today (accounting dates are calendar dates, not instants).
export function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isValidDateString(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}
