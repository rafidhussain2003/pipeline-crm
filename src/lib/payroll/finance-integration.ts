// Phase 21 — FinanceIntegrationService: the ONLY bridge from Payroll into the
// Finance bounded context. Every accounting effect flows through the existing
// JournalService (createAndPost) — payroll NEVER writes a finance table, it only
// records the journal IDs it gets back.
//
// Accrual (on run approval) — a standard, always-balanced payroll accrual:
//   Debit  Salaries & Wages Expense   earnedGross (= net + withholdings)
//   Credit Salary Payable             totalNet
//   Credit Employee Deductions Payable totalWithheld            [only if > 0]
//   (degrades to the spec's 2-line Debit expense / Credit payable when there
//    are no deductions.)
//
// Payment (on "paid"):
//   Debit  Salary Payable   totalNet
//   Credit Cash / Bank       totalNet   → clears the payable to zero.
import { createAndPost, createAccount, ensureFinanceSetup, listAccounts } from "@/lib/finance";
import { centsToMoney, PayrollError } from "./types";

interface RunTotals {
  runId: string;
  runNumber: number | null;
  label: string;
  payDate: string;
  totalNetCents: number;
  totalWithheldCents: number; // deductions + tax withheld
}

// Resolve a finance account id by code, seeding the chart and auto-creating the
// Salary Payable liability the first time payroll posts (it isn't in the base
// seeded chart). Everything goes through the finance service — no direct table
// access.
async function resolveAccounts(companyId: string, actorUserId: string, codes: { expense: string; payable: string; withholdings: string; payment: string }) {
  await ensureFinanceSetup(companyId);
  let accounts = await listAccounts(companyId);
  const byCode = () => new Map(accounts.map((a) => [a.code, a]));

  const ensure = async (code: string, name: string, type: "asset" | "liability" | "equity" | "income" | "expense") => {
    let acc = byCode().get(code);
    if (!acc) {
      await createAccount(companyId, actorUserId, { code, name, type });
      accounts = await listAccounts(companyId);
      acc = byCode().get(code);
    }
    return acc!;
  };

  const expense = byCode().get(codes.expense);
  if (!expense || expense.type !== "expense") throw new PayrollError(`Salary expense account ${codes.expense} is missing or not an expense account`);
  const payable = await ensure(codes.payable, "Salary Payable", "liability");
  const withholdings = await ensure("2000", "Accounts Payable", "liability"); // seeded; catch-all for withholdings
  const payment = byCode().get(codes.payment);
  if (!payment || payment.type !== "asset") throw new PayrollError(`Payment account ${codes.payment} is missing or not a cash/bank account`);

  return { expense, payable, withholdings, payment };
}

export async function postAccrual(
  companyId: string,
  actorUserId: string,
  run: RunTotals,
  accountCodes: { expense: string; payable: string; withholdings: string; payment: string },
): Promise<string> {
  const acc = await resolveAccounts(companyId, actorUserId, accountCodes);
  const earnedGrossCents = run.totalNetCents + run.totalWithheldCents;
  if (earnedGrossCents <= 0) throw new PayrollError("Nothing to accrue — the run total is zero");

  const lines: { accountId: string; debit?: number; credit?: number; description?: string }[] = [
    { accountId: acc.expense.id, debit: earnedGrossCents / 100, description: `Payroll ${run.label}` },
    { accountId: acc.payable.id, credit: run.totalNetCents / 100, description: "Net salaries payable" },
  ];
  if (run.totalWithheldCents > 0) {
    lines.push({ accountId: acc.withholdings.id, credit: run.totalWithheldCents / 100, description: "Employee deductions withheld" });
  }

  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: run.payDate,
    memo: `Payroll accrual — ${run.label}${run.runNumber ? ` (PR-${run.runNumber})` : ""}`,
    sourceType: "payroll_accrual",
    sourceId: run.runId,
    lines,
  });
  return journal.id;
}

export async function postPayment(
  companyId: string,
  actorUserId: string,
  run: { runId: string; runNumber: number | null; label: string; payDate: string; totalNetCents: number },
  accountCodes: { payable: string; payment: string },
): Promise<string> {
  await ensureFinanceSetup(companyId);
  const accounts = await listAccounts(companyId);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const payable = byCode.get(accountCodes.payable);
  const payment = byCode.get(accountCodes.payment);
  if (!payable) throw new PayrollError(`Salary Payable account ${accountCodes.payable} is missing`);
  if (!payment || payment.type !== "asset") throw new PayrollError(`Payment account ${accountCodes.payment} is missing or not a cash/bank account`);
  if (run.totalNetCents <= 0) throw new PayrollError("Nothing to pay — the net total is zero");

  const journal = await createAndPost(companyId, actorUserId, {
    entryDate: run.payDate,
    memo: `Payroll payment — ${run.label}${run.runNumber ? ` (PR-${run.runNumber})` : ""}`,
    sourceType: "payroll_payment",
    sourceId: run.runId,
    lines: [
      { accountId: payable.id, debit: run.totalNetCents / 100, description: "Clear salaries payable" },
      { accountId: payment.id, credit: run.totalNetCents / 100, description: `Salaries paid — ${accountCodes.payment}` },
    ],
  });
  return journal.id;
}

// Exposed for the payslip footer / dashboard formatting.
export { centsToMoney };
