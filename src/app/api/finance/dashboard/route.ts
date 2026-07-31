import { NextResponse } from "next/server";
import { getFinanceCapabilities, financeErrorResponse } from "@/lib/finance/guard";
import { FINANCE_CAPABILITIES, type FinanceCapability } from "@/lib/finance/permissions";
import { ensureFinanceSetup, listAccounts, getAccountBalances, listJournals, ledgerIntegrity, toCents, FINANCE_REPORTS } from "@/lib/finance";
import { FinanceError } from "@/lib/finance/types";
import { db } from "@/db";
import { financeJournalLines, financeAccounts, financeInvestments, financeSettings } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { isSchemaLagError } from "@/lib/db-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger({ component: "finance-dashboard" });

// Finance dashboard: cash/bank totals, month-to-date income & expenses, the
// ledger integrity check, recent entries, and the report placeholders.
export async function GET() {
  const auth = await getFinanceCapabilities();
  if (!auth.ok) return auth.response;
  if (auth.caps.size === 0) return NextResponse.json({ error: "You do not have access to Finance" }, { status: 403 });
  const companyId = auth.session.companyId;
  // Fund balances/totals are shown ONLY to callers with view_balances (admins
  // and managers always; a Finance Employee only if the admin granted it). The
  // recent-entries feed + ledger integrity are report data (view_reports).
  try {
    return await buildDashboard(companyId, auth.caps);
  } catch (err) {
    if (err instanceof FinanceError) return financeErrorResponse(err);
    // The real error goes to the server log with the tenant — previously it
    // vanished into a bare 500 and the page could only say "couldn't load".
    logger.error("finance_dashboard_failed", { companyId, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "The finance dashboard could not load. The error has been logged — try again shortly." }, { status: 500 });
  }
}

async function buildDashboard(companyId: string, caps: Set<FinanceCapability>) {
  const showBalances = caps.has("view_balances");
  const showReports = caps.has("view_reports");
  await ensureFinanceSetup(companyId);

  // Currency is always shown; the rest is computed only when the caller is
  // allowed to see it — this both enforces the gate and skips the expensive
  // aggregate queries for a Finance Employee who can't view them.
  const [settings] = await db
    .select({ defaultCurrency: financeSettings.defaultCurrency })
    .from(financeSettings)
    .where(eq(financeSettings.companyId, companyId))
    .limit(1);

  let cashCents: number | null = null,
    bankCents: number | null = null,
    totalAssetsCents: number | null = null,
    investmentsCents: number | null = null,
    incomeMtdCents: number | null = null,
    expenseMtdCents: number | null = null,
    netMtdCents: number | null = null;

  if (showBalances) {
    const [accounts, balances, activeInvestments] = await Promise.all([
      listAccounts(companyId),
      getAccountBalances(companyId),
      // Enterprise Workspace tiles: current value of live investments.
      // Migration-lag guard: finance_investments ships in 0040 — until it
      // lands, the tile reads zero instead of 500ing the entire dashboard.
      db
        .select({ currentValue: financeInvestments.currentValue })
        .from(financeInvestments)
        .where(and(eq(financeInvestments.companyId, companyId), eq(financeInvestments.status, "active")))
        .catch((err) => {
          if (!isSchemaLagError(err)) throw err;
          logger.error("finance_investments_schema_lag", { companyId, detail: "migration 0040 not applied yet" });
          return [] as { currentValue: string }[];
        }),
    ]);

    cashCents = 0;
    bankCents = 0;
    totalAssetsCents = 0;
    for (const a of accounts) {
      if (a.subtype === "cash") cashCents += balances.get(a.id) ?? 0;
      if (a.subtype === "bank") bankCents += balances.get(a.id) ?? 0;
      if (a.type === "asset") totalAssetsCents += balances.get(a.id) ?? 0;
    }
    investmentsCents = activeInvestments.reduce((sum, r) => sum + toCents(Number(r.currentValue)), 0);

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

    incomeMtdCents = 0;
    expenseMtdCents = 0;
    for (const r of mtd) {
      const d = Math.round(Number(r.debit) * 100);
      const c = Math.round(Number(r.credit) * 100);
      if (r.type === "income") incomeMtdCents += c - d;
      if (r.type === "expense") expenseMtdCents += d - c;
    }
    netMtdCents = incomeMtdCents - expenseMtdCents;
  }

  // Report data (recent feed + ledger integrity) — only for view_reports.
  const [recent, integrity] = showReports
    ? await Promise.all([listJournals(companyId, { limit: 8 }), ledgerIntegrity(companyId)])
    : [[], null];

  return NextResponse.json({
    // null = the caller isn't permitted to see this figure (Finance Employee
    // without View balances). The page hides the tile when the value is null.
    cashCents,
    bankCents,
    incomeMtdCents,
    expenseMtdCents,
    netMtdCents,
    investmentsCents,
    totalAssetsCents,
    canViewBalances: showBalances,
    canViewReports: showReports,
    // The caller's full capability set, so the page can show only the quick
    // actions they can actually perform.
    capabilities: Object.fromEntries(FINANCE_CAPABILITIES.map((c) => [c, caps.has(c)])),
    currency: settings?.defaultCurrency ?? "USD",
    integrity,
    recent,
    reports: FINANCE_REPORTS, // placeholders — none implemented in Phase 19
  });
}
