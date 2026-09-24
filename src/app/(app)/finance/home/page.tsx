"use client";

// My Home — personal home-building budget. Deliberately simple: the total
// budget and what's left on top, the expenses spent from it below, each with
// a note saying where the money went. Not part of company finance.
import { useEffect, useState } from "react";
import { money, PageHeader, todayInput, useFinanceCurrency } from "@/components/finance/shared";

type Expense = { id: string; amountCents: number; note: string; spentOn: string };
type Summary = { totalCents: number; spentCents: number; leftCents: number; expenses: Expense[] };

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

export default function MyHomePage() {
  useFinanceCurrency();
  const [data, setData] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editingBudget, setEditingBudget] = useState(false);

  // Add-expense form
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [spentOn, setSpentOn] = useState(todayInput());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/finance/home");
    if (!res.ok) {
      setLoadError((await res.json().catch(() => ({}))).error || "Could not load My Home.");
      return;
    }
    setData(await res.json());
  };
  useEffect(() => { load(); }, []);

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    const res = await fetch("/api/finance/home/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, note, spentOn }),
    });
    setSaving(false);
    if (!res.ok) {
      setFormError((await res.json().catch(() => ({}))).error || "Could not add expense.");
      return;
    }
    setData(await res.json());
    setAmount("");
    setNote("");
    setSpentOn(todayInput());
  }

  async function removeExpense(id: string) {
    if (!confirm("Remove this expense? Its amount goes back into budget left.")) return;
    setRemovingId(id);
    const res = await fetch(`/api/finance/home/expenses/${id}`, { method: "DELETE" });
    setRemovingId(null);
    if (res.ok) setData(await res.json());
    else setFormError((await res.json().catch(() => ({}))).error || "Could not remove expense.");
  }

  if (loadError) return <div className="p-6 max-w-3xl"><p className="text-sm text-red-600">{loadError}</p></div>;
  if (!data) return <div className="p-6 max-w-3xl"><p className="text-sm text-slate-400">Loading…</p></div>;

  const hasBudget = data.totalCents > 0;
  const overBudget = data.leftCents < 0;
  const usedPct = hasBudget ? Math.min(100, Math.round((data.spentCents / data.totalCents) * 100)) : 0;

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title="My Home"
        subtitle="Personal home-building budget. Kept separate from company finance — nothing here touches the books."
        action={
          <button onClick={() => setEditingBudget(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
            {hasBudget ? "Change budget" : "Set total budget"}
          </button>
        }
      />

      {/* Budget summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total budget</div>
          <div className="text-2xl font-semibold text-slate-900 mt-1">{money(data.totalCents)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Spent so far</div>
          <div className="text-2xl font-semibold text-slate-900 mt-1">{money(data.spentCents)}</div>
        </div>
        <div className={`border rounded-lg p-4 ${overBudget ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
          <div className={`text-[11px] font-semibold uppercase tracking-wide ${overBudget ? "text-red-600" : "text-emerald-700"}`}>
            {overBudget ? "Over budget by" : "Budget left"}
          </div>
          <div className={`text-2xl font-semibold mt-1 ${overBudget ? "text-red-700" : "text-emerald-800"}`}>
            {money(Math.abs(data.leftCents))}
          </div>
        </div>
      </div>

      {hasBudget && (
        <div className="mb-6">
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${overBudget ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${usedPct}%` }} />
          </div>
          <div className="text-xs text-slate-400 mt-1">{usedPct}% of the budget used</div>
        </div>
      )}

      {/* Add expense */}
      <form onSubmit={addExpense} className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Add expense</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr_150px_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              required
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Where it was spent</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Cement 50 bags, plumber advance, tiles for kitchen"
              maxLength={500}
              required
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
            <input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} required className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
        {formError && <p className="text-xs text-red-600 mt-2">{formError}</p>}
      </form>

      {/* Expenses list */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Expenses from budget</h2>
          <span className="text-xs text-slate-400">{data.expenses.length} {data.expenses.length === 1 ? "entry" : "entries"}</span>
        </div>
        <div className="divide-y divide-slate-100">
          {data.expenses.map((x) => (
            <div key={x.id} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-900 break-words">{x.note}</div>
                <div className="text-xs text-slate-400 mt-0.5">{fmtDate(x.spentOn)}</div>
              </div>
              <div className="text-sm font-semibold text-slate-900 whitespace-nowrap">{money(x.amountCents)}</div>
              <button
                onClick={() => removeExpense(x.id)}
                disabled={removingId === x.id}
                title="Remove expense"
                className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1 disabled:opacity-50"
              >
                {removingId === x.id ? "…" : "Remove"}
              </button>
            </div>
          ))}
          {data.expenses.length === 0 && (
            <p className="text-sm text-slate-400 px-4 py-8 text-center">
              {hasBudget ? "No expenses yet. Add the first one above." : "Set your total budget first, then start adding expenses."}
            </p>
          )}
        </div>
      </div>

      {editingBudget && (
        <BudgetModal
          current={data.totalCents}
          onClose={() => setEditingBudget(false)}
          onSaved={(next) => { setData(next); setEditingBudget(false); }}
        />
      )}
    </div>
  );
}

function BudgetModal({ current, onClose, onSaved }: { current: number; onClose: () => void; onSaved: (next: Summary) => void }) {
  const [total, setTotal] = useState(current > 0 ? (current / 100).toFixed(2) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/home", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save budget.");
      return;
    }
    onSaved(await res.json());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">Total budget</h2>
        <p className="text-xs text-slate-500 mb-4">The full amount set aside for the home. Expenses are subtracted from this.</p>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Amount</label>
        <input
          autoFocus
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          required
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
