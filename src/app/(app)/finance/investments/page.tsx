"use client";

import { useEffect, useState } from "react";
import { AccountSelect, money, moneyNum, PageHeader, todayInput, useAccounts, useFinanceCurrency } from "@/components/finance/shared";

// Enterprise Finance Workspace — company investments. Purchases and
// withdrawals post balanced journals through the finance service (balances
// update automatically); gains/losses are computed from the admin-maintained
// current value.

type Investment = {
  id: string;
  name: string;
  category: string | null;
  purchaseDate: string;
  purchaseValue: string;
  currentValue: string;
  status: string;
  withdrawnValue: string | null;
  gainLossCents: number;
  notes: string | null;
};

export default function InvestmentsPage() {
  useFinanceCurrency();
  const { accounts } = useAccounts();
  const [rows, setRows] = useState<Investment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [withdrawFor, setWithdrawFor] = useState<Investment | null>(null);
  const [valueFor, setValueFor] = useState<Investment | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/finance/investments");
    if (res.ok) setRows((await res.json()).investments || []);
  };
  useEffect(() => {
    load();
  }, []);

  const active = rows.filter((r) => r.status === "active");
  const totalCurrentCents = active.reduce((s, r) => s + Math.round(Number(r.currentValue) * 100), 0);
  const totalGainCents = active.reduce((s, r) => s + r.gainLossCents, 0);

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Investments"
        subtitle="Each purchase and withdrawal posts a balanced journal automatically. Gains and losses are calculated from current value."
        action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add investment</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Active investments</div>
          <div className="text-lg font-semibold mt-1 text-slate-900">{active.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Current value</div>
          <div className="text-lg font-semibold mt-1 text-slate-900">{money(totalCurrentCents)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Unrealized gain / loss</div>
          <div className={`text-lg font-semibold mt-1 ${totalGainCents >= 0 ? "text-emerald-700" : "text-red-600"}`}>{money(totalGainCents)}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.status === "withdrawn" ? "opacity-50" : ""}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">
                {r.name}
                {r.status === "withdrawn" && <span className="ml-2 text-[10px] font-semibold uppercase text-slate-400">Withdrawn</span>}
              </div>
              <div className="text-xs text-slate-400">
                {r.category ? `${r.category} · ` : ""}Purchased {r.purchaseDate} for {moneyNum(r.purchaseValue)}
                {r.status === "withdrawn" && r.withdrawnValue ? ` · Withdrawn for ${moneyNum(r.withdrawnValue)}` : ""}
              </div>
            </div>
            <div className="text-right w-28">
              <div className="text-sm font-semibold text-slate-900">{moneyNum(r.currentValue)}</div>
              <div className={`text-[11px] font-medium ${r.gainLossCents >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                {r.gainLossCents >= 0 ? "+" : ""}
                {money(r.gainLossCents)}
              </div>
            </div>
            {r.status === "active" && (
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => setValueFor(r)} className="text-[11px] font-medium text-slate-600 bg-slate-100 rounded px-2 py-1">Update value</button>
                <button onClick={() => setWithdrawFor(r)} className="text-[11px] font-medium text-amber-700 bg-amber-50 rounded px-2 py-1">Withdraw</button>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No investments recorded yet.</p>}
      </div>

      {showForm && (
        <InvestmentModal
          accounts={accounts}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
      {valueFor && (
        <ValueModal
          investment={valueFor}
          onClose={() => setValueFor(null)}
          onSaved={() => {
            setValueFor(null);
            load();
          }}
          onError={setError}
        />
      )}
      {withdrawFor && (
        <WithdrawModal
          accounts={accounts}
          investment={withdrawFor}
          onClose={() => setWithdrawFor(null)}
          onSaved={() => {
            setWithdrawFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function InvestmentModal({ accounts, onClose, onSaved }: { accounts: ReturnType<typeof useAccounts>["accounts"]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayInput());
  const [purchaseValue, setPurchaseValue] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/investments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category: category || null, purchaseDate, purchaseValue: Number(purchaseValue), paymentAccountId, notes: notes || null }),
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
        <h2 className="text-base font-semibold text-slate-900 mb-4">Add investment</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fixed deposit, equipment, shares" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Category (optional)</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Deposit / Property / Stock" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Purchase date</label>
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Purchase value</label>
            <input type="number" step="0.01" min="0.01" value={purchaseValue} onChange={(e) => setPurchaseValue(e.target.value)} placeholder="0.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Paid from</label>
            <AccountSelect accounts={accounts} value={paymentAccountId} onChange={setPaymentAccountId} filter={(a) => a.type === "asset" && (a.subtype === "cash" || a.subtype === "bank")} placeholder="Cash or bank account" />
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
            {saving ? "Posting…" : "Add & post"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ValueModal({ investment, onClose, onSaved, onError }: { investment: Investment; onClose: () => void; onSaved: () => void; onError: (e: string) => void }) {
  const [value, setValue] = useState(investment.currentValue);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/finance/investments/${investment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentValue: Number(value) }),
    });
    setSaving(false);
    if (!res.ok) {
      onError((await res.json().catch(() => ({}))).error || "Could not update value");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">Update current value</h2>
        <p className="text-xs text-slate-500 mb-4">{investment.name} — purchased for {moneyNum(investment.purchaseValue)}</p>
        <input type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WithdrawModal({ accounts, investment, onClose, onSaved }: { accounts: ReturnType<typeof useAccounts>["accounts"]; investment: Investment; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(investment.currentValue);
  const [date, setDate] = useState(todayInput());
  const [depositAccountId, setDepositAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/finance/investments/${investment.id}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(amount), date, depositAccountId }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not withdraw");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">Withdraw investment</h2>
        <p className="text-xs text-slate-500 mb-4">{investment.name} — the amount returns to cash/bank and posts automatically.</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Amount received</label>
              <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Deposit to</label>
            <AccountSelect accounts={accounts} value={depositAccountId} onChange={setDepositAccountId} filter={(a) => a.type === "asset" && (a.subtype === "cash" || a.subtype === "bank")} placeholder="Cash or bank account" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Posting…" : "Withdraw & post"}
          </button>
        </div>
      </div>
    </div>
  );
}
