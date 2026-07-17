"use client";

// Phase 21 — shared page body for Incentives and Deductions (same table, one
// differs only by `kind` and its category list).
import { useEffect, useState } from "react";
import { money, PageHeader, todayStr } from "@/components/payroll/shared";

type Adjustment = {
  id: string; userId: string; userName: string; kind: string; category: string; label: string;
  amountCents: number; recurring: boolean; effectiveDate: string; endDate: string | null; status: string;
};
type Employee = { userId: string; name: string };

const CATEGORIES: Record<string, { value: string; label: string }[]> = {
  incentive: [
    { value: "fixed", label: "Fixed" },
    { value: "performance", label: "Performance" },
    { value: "sales", label: "Sales" },
    { value: "manual", label: "Manual" },
    { value: "recurring", label: "Recurring" },
  ],
  deduction: [
    { value: "manual", label: "Manual" },
    { value: "recurring", label: "Recurring" },
    { value: "penalty", label: "Penalty (placeholder)" },
    { value: "loan", label: "Loan (placeholder)" },
    { value: "advance", label: "Advance (placeholder)" },
  ],
};

const STATUS_STYLES: Record<string, string> = { active: "text-emerald-700 bg-emerald-50", consumed: "text-slate-500 bg-slate-100", cancelled: "text-red-600 bg-red-50" };

export default function AdjustmentsPage({ kind }: { kind: "incentive" | "deduction" }) {
  const title = kind === "incentive" ? "Incentives" : "Deductions";
  const [rows, setRows] = useState<Adjustment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const [aRes, eRes] = await Promise.all([fetch(`/api/payroll/adjustments?kind=${kind}`), fetch("/api/payroll/profiles")]);
    if (aRes.ok) setRows((await aRes.json()).adjustments || []);
    if (eRes.ok) setEmployees(((await eRes.json()).employees || []).map((e: { userId: string; name: string }) => ({ userId: e.userId, name: e.name })));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind]);

  async function cancel(id: string) {
    setError("");
    const res = await fetch(`/api/payroll/adjustments/${id}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not cancel");
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title={title}
        subtitle={kind === "incentive" ? "Fixed, performance, sales, manual and recurring incentives added to pay." : "Manual, recurring, penalty, loan and advance deductions taken from pay."}
        action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add {kind}</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.status !== "active" ? "opacity-60" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{r.userName} — {r.label}</div>
              <div className="text-xs text-slate-400 capitalize">
                {r.category} · {r.recurring ? "recurring" : "one-time"} · from {r.effectiveDate}{r.endDate ? ` to ${r.endDate}` : ""}
              </div>
            </div>
            <span className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ${STATUS_STYLES[r.status] || "text-slate-500 bg-slate-100"}`}>{r.status}</span>
            <span className="text-sm font-semibold text-slate-900 w-24 text-right">{money(r.amountCents)}</span>
            {r.status === "active" && <button onClick={() => cancel(r.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Cancel</button>}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No {kind}s yet.</p>}
      </div>

      {showForm && <Modal kind={kind} employees={employees} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function Modal({ kind, employees, onClose, onSaved }: { kind: "incentive" | "deduction"; employees: Employee[]; onClose: () => void; onSaved: () => void }) {
  const [userId, setUserId] = useState("");
  const [category, setCategory] = useState(CATEGORIES[kind][0].value);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [effectiveDate, setEffective] = useState(todayStr());
  const [endDate, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/payroll/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, kind, category, label, amount: Number(amount), recurring, effectiveDate, endDate: recurring ? endDate || null : null }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4 capitalize">Add {kind}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Employee</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="" disabled>Select…</option>
              {employees.map((e) => <option key={e.userId} value={e.userId}>{e.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                {CATEGORIES[kind].map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Amount</label>
              <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "incentive" ? "Q3 sales bonus" : "Uniform deduction"} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            Recurring (applies every run)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{recurring ? "Starts" : "Effective date"}</label>
              <input type="date" value={effectiveDate} onChange={(e) => setEffective(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            {recurring && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Ends (optional)</label>
                <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Saving…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
