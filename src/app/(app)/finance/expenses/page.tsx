"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountSelect, moneyNum, PageHeader, StatusBadge, todayInput, useAccounts, useFinanceCurrency } from "@/components/finance/shared";

type Expense = {
  id: string; docNumber: number; entryDate: string; vendorName: string; category: string | null;
  paymentMethod: string; receiptRef: string | null; amount: string; status: string; notes: string | null;
};

export default function ExpensesPage() {
  useFinanceCurrency();
  const { accounts } = useAccounts();
  const [rows, setRows] = useState<Expense[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  // Workspace quick actions land here with ?category=Customer%20Payout /
  // Salary — open the form pre-filled so a payout/salary is one click away.
  const searchParams = useSearchParams();
  const presetCategory = searchParams.get("category") || "";
  useEffect(() => {
    if (presetCategory) setShowForm(true);
  }, [presetCategory]);

  const load = async () => {
    const res = await fetch("/api/finance/expenses");
    if (res.ok) setRows((await res.json()).expenses || []);
  };
  useEffect(() => { load(); }, []);

  async function voidDoc(id: string) {
    setError("");
    const res = await fetch(`/api/finance/expenses/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not void");
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Expenses"
        subtitle="Money spent. Each entry posts a balanced journal automatically (debit expense, credit cash/bank)."
        action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Record expense</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.status === "voided" ? "opacity-50" : ""}`}>
            <span className="text-xs font-mono text-slate-400 w-16 shrink-0">EX-{r.docNumber}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{r.vendorName}</div>
              <div className="text-xs text-slate-400 capitalize">
                {r.entryDate} · {r.paymentMethod}{r.category ? ` · ${r.category}` : ""}{r.receiptRef ? ` · Receipt ${r.receiptRef}` : ""}
              </div>
            </div>
            <StatusBadge status={r.status} />
            <span className="text-sm font-semibold text-slate-900 w-24 text-right">{moneyNum(r.amount)}</span>
            <a
              href={`/api/finance/expenses/${r.id}/receipt`}
              className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2 py-1"
            >
              Receipt
            </a>
            {r.status === "posted" && (
              <button onClick={() => voidDoc(r.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Void</button>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No expenses recorded yet.</p>}
      </div>

      {showForm && <ExpenseModal accounts={accounts} presetCategory={presetCategory} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function ExpenseModal({ accounts, presetCategory, onClose, onSaved }: { accounts: ReturnType<typeof useAccounts>["accounts"]; presetCategory?: string; onClose: () => void; onSaved: () => void }) {
  const [entryDate, setEntryDate] = useState(todayInput());
  const [vendorName, setVendorName] = useState("");
  const [category, setCategory] = useState(presetCategory || "");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [receiptRef, setReceiptRef] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryDate, vendorName, category: category || null, paymentMethod, receiptRef: receiptRef || null,
        amount: Number(amount), expenseAccountId, paymentAccountId, notes: notes || null,
      }),
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
        <h2 className="text-base font-semibold text-slate-900 mb-4">Record expense</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
              <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Amount</label>
              <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Vendor</label>
            <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Who was paid" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Category (optional)</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Office" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Payment method</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                {["cash", "bank", "card", "other"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Expense account</label>
            <AccountSelect accounts={accounts} value={expenseAccountId} onChange={setExpenseAccountId} filter={(a) => a.type === "expense"} placeholder="What kind of expense?" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Paid from</label>
            <AccountSelect accounts={accounts} value={paymentAccountId} onChange={setPaymentAccountId} filter={(a) => a.type === "asset" && (a.subtype === "cash" || a.subtype === "bank")} placeholder="Cash or bank account" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Receipt reference (optional)</label>
            <input value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} placeholder="Receipt # (uploads coming soon)" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Posting…" : "Record & post"}
          </button>
        </div>
      </div>
    </div>
  );
}
