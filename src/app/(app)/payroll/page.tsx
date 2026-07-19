"use client";

import Link from "next/link";
import { useLoadedData, LoadingPane, LoadErrorPane } from "@/components/LoadState";
import { money, PageHeader, StatusBadge } from "@/components/payroll/shared";

type Dashboard = {
  currentPeriod: { label: string; start: string; end: string; status: string } | null;
  employees: number;
  activeStaff: number;
  unconfiguredStaff: number;
  pendingPayroll: number;
  processedPayroll: number;
  paidPayroll: number;
  pendingApprovals: number;
  totalGrossCents: number;
  totalNetCents: number;
  upcomingPayrollDate: string;
};

export default function PayrollDashboardPage() {
  const { data, loading, error, reload } = useLoadedData<Dashboard>("/api/payroll/dashboard", (b) => b as Dashboard);

  if (loading) return <LoadingPane />;
  if (error || !data) return <LoadErrorPane message={error || "No data was returned."} onRetry={reload} />;

  const cards: { label: string; value: string | number; tone?: string }[] = [
    { label: "Employees", value: data.employees },
    { label: "Pending payroll", value: data.pendingPayroll, tone: data.pendingPayroll > 0 ? "text-amber-600" : undefined },
    { label: "Processed", value: data.processedPayroll },
    { label: "Paid", value: data.paidPayroll, tone: "text-emerald-700" },
    { label: "Pending approvals", value: data.pendingApprovals, tone: data.pendingApprovals > 0 ? "text-amber-600" : undefined },
    { label: "Total gross", value: money(data.totalGrossCents) },
    { label: "Total net", value: money(data.totalNetCents) },
    { label: "Upcoming pay date", value: data.upcomingPayrollDate },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Payroll" subtitle="Salary runs, integrated with your books and attendance." />

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Current payroll period</div>
          {data.currentPeriod ? (
            <div className="text-sm font-semibold text-slate-900 mt-1 flex items-center gap-2">
              {data.currentPeriod.label}
              <span className="text-xs font-normal text-slate-400">{data.currentPeriod.start} → {data.currentPeriod.end}</span>
              <StatusBadge status={data.currentPeriod.status} />
            </div>
          ) : (
            <div className="text-sm text-slate-400 mt-1">No payroll runs yet.</div>
          )}
        </div>
        <Link href="/payroll/runs" className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Go to runs</Link>
      </div>

      {data.unconfiguredStaff > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-2 mb-4">
          {data.unconfiguredStaff} active staff member{data.unconfiguredStaff === 1 ? " has" : "s have"} no payroll profile yet — <Link href="/payroll/employees" className="underline">set them up</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</div>
            <div className={`text-lg font-semibold mt-1 ${c.tone || "text-slate-900"}`}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
