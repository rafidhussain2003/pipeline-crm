"use client";

import { useEffect, useState } from "react";
import { money, PageHeader, StatusBadge, todayStr } from "@/components/payroll/shared";

type Run = {
  id: string; runNumber: number | null; label: string; frequency: string;
  periodStart: string; periodEnd: string; payDate: string; status: string;
  totalGrossCents: number; totalNetCents: number; totalDeductionsCents: number;
  employeeCount: number; accrualJournalId: string | null; paymentJournalId: string | null;
};
type Item = { id: string; userName: string; basicCents: number; allowancesCents: number; incentivesCents: number; overtimeCents: number; grossCents: number; deductionsCents: number; leaveAdjustmentCents: number; netCents: number };

export default function PayrollRunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<(Run & { items: Item[] }) | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/payroll/runs");
    if (res.ok) setRuns((await res.json()).runs || []);
  };
  useEffect(() => { load(); }, []);

  async function open(id: string) {
    const res = await fetch(`/api/payroll/runs/${id}`);
    if (res.ok) setDetail((await res.json()).run);
  }

  async function act(id: string, action: string) {
    setError("");
    const res = await fetch(`/api/payroll/runs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Action failed");
      return;
    }
    const data = await res.json();
    setDetail(data.run);
    load();
  }

  async function discard(id: string) {
    await fetch(`/api/payroll/runs/${id}`, { method: "DELETE" });
    setDetail(null);
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Payroll Runs"
        subtitle="draft → calculated → approved → paid. Approval posts the accrual to Finance; marking paid posts the payment."
        action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">New run</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {runs.map((r) => (
          <button key={r.id} onClick={() => open(r.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <span className="text-xs font-mono text-slate-400 w-14 shrink-0">{r.runNumber ? `PR-${r.runNumber}` : "—"}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{r.label}</div>
              <div className="text-xs text-slate-400">{r.periodStart} → {r.periodEnd} · {r.employeeCount} employee(s)</div>
            </div>
            <StatusBadge status={r.status} />
            <span className="text-sm font-semibold text-slate-900 w-24 text-right">{money(r.totalNetCents)}</span>
          </button>
        ))}
        {runs.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No payroll runs yet.</p>}
      </div>

      {showForm && <RunModal onClose={() => setShowForm(false)} onSaved={(id) => { setShowForm(false); load(); open(id); }} />}
      {detail && <RunDetail run={detail} onClose={() => setDetail(null)} onAct={act} onDiscard={discard} error={error} />}
    </div>
  );
}

function RunModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const now = new Date();
  const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [label, setLabel] = useState(`Payroll ${now.toLocaleString("en-US", { month: "long", year: "numeric" })}`);
  const [frequency, setFrequency] = useState("monthly");
  const [periodStart, setStart] = useState(first);
  const [periodEnd, setEnd] = useState(last);
  const [payDate, setPay] = useState(last);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/payroll/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, frequency, periodStart, periodEnd, payDate }) });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not create");
      return;
    }
    onSaved((await res.json()).run.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">New payroll run</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Label</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Frequency</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                {["monthly", "weekly", "biweekly", "hourly"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Pay date</label>
              <input type="date" value={payDate} onChange={(e) => setPay(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Period start</label>
              <input type="date" value={periodStart} onChange={(e) => setStart(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Period end</label>
              <input type="date" value={periodEnd} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Creating…" : "Create draft"}</button>
        </div>
      </div>
    </div>
  );
}

function RunDetail({ run, onClose, onAct, onDiscard, error }: { run: Run & { items: Item[] }; onClose: () => void; onAct: (id: string, a: string) => void; onDiscard: (id: string) => void; error: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-slate-900">{run.label}{run.runNumber ? ` · PR-${run.runNumber}` : ""}</h2>
          <StatusBadge status={run.status} />
        </div>
        <p className="text-xs text-slate-400 mb-3">{run.periodStart} → {run.periodEnd} · pay {run.payDate}{run.accrualJournalId ? " · accrual posted" : ""}{run.paymentJournalId ? " · payment posted" : ""}</p>
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        {run.items.length > 0 ? (
          <div className="overflow-x-auto border border-slate-200 rounded-md mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="text-left font-medium px-3 py-2">Employee</th>
                  <th className="text-right font-medium px-2 py-2">Gross</th>
                  <th className="text-right font-medium px-2 py-2">Deductions</th>
                  <th className="text-right font-medium px-3 py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {run.items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 text-slate-800 max-w-[180px] truncate">{it.userName}</td>
                    <td className="px-2 py-2 text-right text-slate-700">{money(it.grossCents)}</td>
                    <td className="px-2 py-2 text-right text-slate-500">{money(it.deductionsCents + it.leaveAdjustmentCents)}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">{money(it.netCents)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-3 py-2 text-slate-700">Total ({run.employeeCount})</td>
                  <td className="px-2 py-2 text-right">{money(run.totalGrossCents)}</td>
                  <td className="px-2 py-2 text-right">{money(run.totalDeductionsCents)}</td>
                  <td className="px-3 py-2 text-right">{money(run.totalNetCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400 mb-4">Not calculated yet — run the calculation to pull in salaries, attendance, incentives and deductions.</p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {(run.status === "draft" || run.status === "calculated") && (
            <button onClick={() => onAct(run.id, "calculate")} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">{run.status === "calculated" ? "Recalculate" : "Calculate"}</button>
          )}
          {run.status === "calculated" && (
            <>
              <button onClick={() => onDiscard(run.id)} className="text-sm font-medium text-red-600 px-3 py-2 rounded-md hover:bg-red-50">Discard</button>
              <button onClick={() => onAct(run.id, "approve")} className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-md">Approve (post accrual)</button>
            </>
          )}
          {run.status === "approved" && (
            <>
              <button onClick={() => onAct(run.id, "lock")} className="text-sm font-medium text-slate-600 px-3 py-2 rounded-md hover:bg-slate-50">Lock</button>
              <button onClick={() => onAct(run.id, "pay")} className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-md">Mark paid (post payment)</button>
            </>
          )}
          {run.status === "locked" && (
            <button onClick={() => onAct(run.id, "pay")} className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-md">Mark paid (post payment)</button>
          )}
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}
