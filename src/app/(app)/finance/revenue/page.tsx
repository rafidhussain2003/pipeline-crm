"use client";

import { useEffect, useState } from "react";
import { AccountSelect, moneyNum, PageHeader, StatusBadge, todayInput, useAccounts } from "@/components/finance/shared";

type Revenue = {
  id: string; docNumber: number; entryDate: string; customerName: string; invoiceRef: string | null;
  amount: string; status: string; notes: string | null;
};

export default function RevenuePage() {
  const { accounts } = useAccounts();
  const [rows, setRows] = useState<Revenue[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/finance/revenues");
    if (res.ok) setRows((await res.json()).revenues || []);
  };
  useEffect(() => { load(); }, []);

  async function voidDoc(id: string) {
    setError("");
    const res = await fetch(`/api/finance/revenues/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not void");
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Revenue"
        subtitle="Money received. Each entry posts a balanced journal automatically (debit cash/bank, credit income)."
        action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Record revenue</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.status === "voided" ? "opacity-50" : ""}`}>
            <span className="text-xs font-mono text-slate-400 w-16 shrink-0">RV-{r.docNumber}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{r.customerName}</div>
              <div className="text-xs text-slate-400">{r.entryDate}{r.invoiceRef ? ` · Invoice ${r.invoiceRef}` : ""}{r.notes ? ` · ${r.notes}` : ""}</div>
            </div>
            <StatusBadge status={r.status} />
            <span className="text-sm font-semibold text-slate-900 w-24 text-right">{moneyNum(r.amount)}</span>
            {r.status === "posted" && (
              <button onClick={() => voidDoc(r.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Void</button>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No revenue recorded yet.</p>}
      </div>

      {showForm && <RevenueModal accounts={accounts} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function RevenueModal({ accounts, onClose, onSaved }: { accounts: ReturnType<typeof useAccounts>["accounts"]; onClose: () => void; onSaved: () => void }) {
  const [entryDate, setEntryDate] = useState(todayInput());
  const [customerName, setCustomerName] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [amount, setAmount] = useState("");
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const [depositAccountId, setDepositAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/revenues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryDate, customerName, invoiceRef: invoiceRef || null, amount: Number(amount), incomeAccountId, depositAccountId, notes: notes || null }),
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
        <h2 className="text-base font-semibold text-slate-900 mb-4">Record revenue</h2>
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
            <label className="block text-xs font-semibold text-slate-600 mb-1">Customer</label>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Invoice reference (optional)</label>
            <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="INV-0042" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Income account</label>
            <AccountSelect accounts={accounts} value={incomeAccountId} onChange={setIncomeAccountId} filter={(a) => a.type === "income"} placeholder="Which income is this?" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Deposited into</label>
            <AccountSelect accounts={accounts} value={depositAccountId} onChange={setDepositAccountId} filter={(a) => a.type === "asset" && (a.subtype === "cash" || a.subtype === "bank")} placeholder="Cash or bank account" />
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
