"use client";

import Link from "next/link";
import { useLoadedData, LoadingPane, LoadErrorPane } from "@/components/LoadState";
import { money, moneyNum, useFinanceCurrency, PageHeader, StatusBadge } from "@/components/finance/shared";

// Balance figures are null when the caller lacks View balances (a Finance
// Employee the admin hasn't granted it); the tiles are then hidden entirely.
type Dashboard = {
  cashCents: number | null;
  bankCents: number | null;
  incomeMtdCents: number | null;
  expenseMtdCents: number | null;
  netMtdCents: number | null;
  investmentsCents: number | null;
  totalAssetsCents: number | null;
  canViewBalances: boolean;
  canViewReports: boolean;
  capabilities: Record<string, boolean>;
  currency: string;
  integrity: { balanced: boolean; debitCents: number; creditCents: number } | null;
  recent: { id: string; entryNumber: number | null; entryDate: string; memo: string | null; status: string; sourceType: string; total: string }[];
  reports: { key: string; label: string; implemented: boolean }[];
};

// Quick transaction actions — every one lands on an EXISTING recording page
// (expenses / revenue / investments), pre-filled where it helps. Each is gated
// on the capability it needs, so a Finance Employee sees only what they can do
// (admins/managers hold every capability, so they see all).
const QUICK_ACTIONS = [
  { href: "/finance/expenses?docType=payout", label: "Customer Payout", cap: "record_payout" },
  { href: "/finance/expenses?docType=salary", label: "Salary Payment", cap: "record_expense" },
  { href: "/finance/expenses", label: "Business Expense", cap: "record_expense" },
  { href: "/finance/revenue", label: "Other Income", cap: "record_income" },
  { href: "/finance/investments", label: "Investment", cap: "manage" },
  { href: "/finance/investments", label: "Withdrawal", cap: "manage" },
];

export default function FinanceDashboardPage() {
  useFinanceCurrency();
  const { data, loading, error, reload } = useLoadedData<Dashboard>("/api/finance/dashboard", (b) => b as Dashboard);

  if (loading) return <LoadingPane />;
  if (error || !data) return <LoadErrorPane message={error || "No data was returned."} onRetry={reload} />;

  const cards =
    data.canViewBalances && data.cashCents !== null
      ? [
          { label: "Cash balance", value: money((data.cashCents ?? 0) + (data.bankCents ?? 0)) },
          { label: "Company investments", value: money(data.investmentsCents ?? 0) },
          { label: "Total assets", value: money(data.totalAssetsCents ?? 0) },
          { label: "Income this month", value: money(data.incomeMtdCents ?? 0) },
          { label: "Expenses this month", value: money(data.expenseMtdCents ?? 0) },
          { label: "Profit / Loss", value: money(data.netMtdCents ?? 0), tone: (data.netMtdCents ?? 0) >= 0 ? "text-emerald-700" : "text-red-600" },
        ]
      : [];

  const actions = QUICK_ACTIONS.filter((a) => data.capabilities[a.cap]);

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Finance" subtitle="Your books at a glance. Every figure comes from the posted general ledger." />

      {cards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</div>
              <div className={`text-lg font-semibold mt-1 ${c.tone || "text-slate-900"}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {actions.map((a) => (
            <Link
              key={a.label}
              href={a.href}
              className="text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-3 py-1.5"
            >
              + {a.label}
            </Link>
          ))}
        </div>
      )}

      {data.integrity && (
        <div className={`mt-3 text-xs rounded-md px-3 py-2 inline-block ${data.integrity.balanced ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}`}>
          {data.integrity.balanced
            ? `Ledger balanced — debits equal credits (${money(data.integrity.debitCents)})`
            : `LEDGER OUT OF BALANCE: debits ${money(data.integrity.debitCents)} vs credits ${money(data.integrity.creditCents)} — contact support`}
        </div>
      )}

      {!data.canViewReports && actions.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">Use the buttons above to record entries. Ask your admin for access to balances or reports.</p>
      )}

      {data.canViewReports && (
      <div className="grid md:grid-cols-[1fr_260px] gap-5 mt-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Recent journal entries</h2>
            <Link href="/finance/journal" className="text-xs font-medium text-blue-600">View all</Link>
          </div>
          <div className="space-y-2">
            {data.recent.map((j) => (
              <div key={j.id} className="flex items-center gap-3 border-b border-slate-100 pb-2 last:border-0">
                <span className="text-xs font-mono text-slate-400 w-16 shrink-0">{j.entryNumber ? `JE-${j.entryNumber}` : "draft"}</span>
                <span className="text-sm text-slate-800 flex-1 min-w-0 truncate">{j.memo || j.sourceType}</span>
                <StatusBadge status={j.status} />
                <span className="text-sm font-medium text-slate-900 w-24 text-right">{moneyNum(j.total)}</span>
              </div>
            ))}
            {data.recent.length === 0 && <p className="text-xs text-slate-400">No entries yet. Record revenue, an expense, or a journal entry to get started.</p>}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 h-fit">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Reports</h2>
          <div className="space-y-1.5">
            {data.reports.map((r) => (
              <div key={r.key} className="flex items-center justify-between text-sm text-slate-500">
                <span>{r.label}</span>
                <span className="text-[10px] font-semibold uppercase text-slate-400">Coming soon</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
