"use client";

import Link from "next/link";
import { useLoadedData, LoadingPane, LoadErrorPane } from "@/components/LoadState";
import { money, moneyNum, useFinanceCurrency, PageHeader, StatusBadge } from "@/components/finance/shared";

type Dashboard = {
  cashCents: number;
  bankCents: number;
  incomeMtdCents: number;
  expenseMtdCents: number;
  netMtdCents: number;
  investmentsCents: number;
  totalAssetsCents: number;
  currency: string;
  integrity: { balanced: boolean; debitCents: number; creditCents: number };
  recent: { id: string; entryNumber: number | null; entryDate: string; memo: string | null; status: string; sourceType: string; total: string }[];
  reports: { key: string; label: string; implemented: boolean }[];
};

// Quick transaction actions — every one lands on an EXISTING recording page
// (expenses / revenue / investments), pre-filled where it helps. One posting
// engine, several doorways.
const QUICK_ACTIONS = [
  { href: "/finance/expenses?category=Customer%20Payout", label: "Customer Payout" },
  { href: "/finance/expenses?category=Salary", label: "Salary Payment" },
  { href: "/finance/expenses", label: "Business Expense" },
  { href: "/finance/revenue", label: "Other Income" },
  { href: "/finance/investments", label: "Investment" },
  { href: "/finance/investments", label: "Withdrawal" },
];

export default function FinanceDashboardPage() {
  useFinanceCurrency();
  const { data, loading, error, reload } = useLoadedData<Dashboard>("/api/finance/dashboard", (b) => b as Dashboard);

  if (loading) return <LoadingPane />;
  if (error || !data) return <LoadErrorPane message={error || "No data was returned."} onRetry={reload} />;

  const cards = [
    { label: "Cash balance", value: money(data.cashCents + data.bankCents) },
    { label: "Company investments", value: money(data.investmentsCents) },
    { label: "Total assets", value: money(data.totalAssetsCents) },
    { label: "Income this month", value: money(data.incomeMtdCents) },
    { label: "Expenses this month", value: money(data.expenseMtdCents) },
    { label: "Profit / Loss", value: money(data.netMtdCents), tone: data.netMtdCents >= 0 ? "text-emerald-700" : "text-red-600" },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Finance" subtitle="Your books at a glance. Every figure comes from the posted general ledger." />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</div>
            <div className={`text-lg font-semibold mt-1 ${c.tone || "text-slate-900"}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-3 py-1.5"
          >
            + {a.label}
          </Link>
        ))}
      </div>

      <div className={`mt-3 text-xs rounded-md px-3 py-2 inline-block ${data.integrity.balanced ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"}`}>
        {data.integrity.balanced
          ? `Ledger balanced — debits equal credits (${money(data.integrity.debitCents)})`
          : `LEDGER OUT OF BALANCE: debits ${money(data.integrity.debitCents)} vs credits ${money(data.integrity.creditCents)} — contact support`}
      </div>

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
    </div>
  );
}
