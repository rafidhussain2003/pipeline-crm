// Phase 19 — public surface of the Finance bounded context. Future modules
// (Payroll, Attendance, Expenses automation, Inventory, Assets, Projects)
// integrate ONLY through these services — never by touching finance tables.
export { FinanceError, toCents, toMoneyString, todayDate, isValidDateString, ACCOUNT_TYPES, DEBIT_NORMAL, PAYMENT_METHODS } from "./types";
export type { AccountType, AccountSubtype, JournalLineInput } from "./types";

export {
  ensureFinanceSetup, listAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  getAccountBalances, SYSTEM_ACCOUNTS, OPENING_EQUITY_CODE,
} from "./accounts";
export type { CreateAccountInput } from "./accounts";

export { createDraft, updateDraft, postJournal, voidJournal, deleteDraft, createAndPost, getJournal, listJournals } from "./journal";
export type { CreateJournalInput } from "./journal";

export { getAccountLedger, ledgerIntegrity, FINANCE_REPORTS } from "./ledger";
export type { LedgerQuery, FinanceReportDef } from "./ledger";

export { createRevenue, voidRevenue, listRevenues, createExpense, voidExpense, listExpenses } from "./documents";
export type { CreateRevenueInput, CreateExpenseInput } from "./documents";

export { listYears, createYear, setYearStatus, assertDatePostable } from "./years";
export { getOpeningState, setOpeningBalance, confirmOpeningBalances, guardOpeningVoid } from "./opening";
export { hasFinancePermission } from "./permissions";
export type { FinancePermission } from "./permissions";

// FinanceService — the named facade the spec asks for, grouping the service
// families under one import for future modules:
//   financeService.accounts / journal / ledger / revenue / expense / years / opening
import * as accountsSvc from "./accounts";
import * as journalSvc from "./journal";
import * as ledgerSvc from "./ledger";
import * as documentsSvc from "./documents";
import * as yearsSvc from "./years";
import * as openingSvc from "./opening";

export const financeService = {
  accounts: accountsSvc,
  journal: journalSvc,
  ledger: ledgerSvc,
  revenue: { create: documentsSvc.createRevenue, void: documentsSvc.voidRevenue, list: documentsSvc.listRevenues },
  expense: { create: documentsSvc.createExpense, void: documentsSvc.voidExpense, list: documentsSvc.listExpenses },
  years: yearsSvc,
  opening: openingSvc,
};
