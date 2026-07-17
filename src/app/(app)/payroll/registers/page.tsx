"use client";

import { useEffect, useState } from "react";
import { money, PageHeader, StatusBadge } from "@/components/payroll/shared";

type Row = {
  itemId: string; runLabel: string; periodStart: string; periodEnd: string; status: string;
  userName: string; department: string | null; grossCents: number; deductionsCents: number; netCents: number;
};

export default function SalaryRegistersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const load = async () => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("search", search.trim());
    if (status) p.set("status", status);
    const res = await fetch(`/api/payroll/register?${p}`);
    if (res.ok) setRows((await res.json()).rows || []);
  };
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Salary Registers" subtitle="Every payslip line across all runs — searchable by employee, run or status." />

      <div className="flex flex-wrap gap-2 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee or run…" className="flex-1 min-w-[200px] rounded-md border border-slate-200 px-3 py-2 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
          <option value="">All statuses</option>
          {["draft", "calculated", "approved", "locked", "paid"].map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="text-left font-medium px-4 py-2">Period</th>
              <th className="text-left font-medium px-2 py-2">Employee</th>
              <th className="text-left font-medium px-2 py-2">Department</th>
              <th className="text-left font-medium px-2 py-2">Status</th>
              <th className="text-right font-medium px-2 py-2">Gross</th>
              <th className="text-right font-medium px-2 py-2">Deductions</th>
              <th className="text-right font-medium px-4 py-2">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.itemId} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2 text-slate-600 whitespace-nowrap text-xs">{r.periodStart} → {r.periodEnd}</td>
                <td className="px-2 py-2 text-slate-900 font-medium max-w-[160px] truncate">{r.userName}</td>
                <td className="px-2 py-2 text-slate-400 text-xs">{r.department || "—"}</td>
                <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-2 py-2 text-right text-slate-700">{money(r.grossCents)}</td>
                <td className="px-2 py-2 text-right text-slate-500">{money(r.deductionsCents)}</td>
                <td className="px-4 py-2 text-right font-medium text-slate-900">{money(r.netCents)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No payroll records{search || status ? " match" : " yet"}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
