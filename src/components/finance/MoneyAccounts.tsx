"use client";

// Phase 19 — shared implementation of the Cash Accounts and Bank Accounts
// pages (identical mechanics, different subtype): balance cards from the
// ledger, create-account, and set-opening-balance while unlocked.
import { useEffect, useState } from "react";
import { money, PageHeader, todayInput, useAccounts, type UiAccount } from "@/components/finance/shared";

export default function MoneyAccounts({ subtype }: { subtype: "cash" | "bank" }) {
  const { accounts, loaded, reload } = useAccounts();
  const [opening, setOpening] = useState<{ locked: boolean; openedAccountIds: string[] } | null>(null);
  const [modal, setModal] = useState<null | { kind: "create" } | { kind: "opening"; account: UiAccount }>(null);
  const label = subtype === "cash" ? "Cash Accounts" : "Bank Accounts";

  const loadOpening = async () => {
    const res = await fetch("/api/finance/opening-balances");
    if (res.ok) setOpening(await res.json());
  };
  useEffect(() => { loadOpening(); }, []);

  const list = accounts.filter((a) => a.subtype === subtype);

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title={label}
        subtitle={
          subtype === "cash"
            ? "Cash in hand and petty cash. Balances come straight from the ledger."
            : "Bank accounts by nickname. Balances from the ledger — live bank feeds and reconciliation are coming later."
        }
        action={<button onClick={() => setModal({ kind: "create" })} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add {subtype} account</button>}
      />

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {list.map((a) => {
          const meta = (a as UiAccount & { metadata?: { nickname?: string; currency?: string } }).metadata || {};
          return (
            <div key={a.id} className={`bg-white border border-slate-200 rounded-lg p-4 ${a.active ? "" : "opacity-50"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{meta.nickname || a.name}</div>
                  <div className="text-xs text-slate-400">{a.code}{meta.currency ? ` · ${meta.currency}` : ""}</div>
                </div>
                {subtype === "bank" && <span className="text-[10px] font-semibold uppercase text-slate-300 shrink-0">Reconcile — soon</span>}
              </div>
              <div className="text-xl font-semibold text-slate-900 mt-3">{money(a.balanceCents)}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Current balance</div>
              {opening && !opening.locked && (
                <button onClick={() => setModal({ kind: "opening", account: a })} className="mt-3 text-[11px] font-medium text-blue-600">
                  {opening.openedAccountIds.includes(a.id) ? "Adjust opening balance" : "Set opening balance"}
                </button>
              )}
            </div>
          );
        })}
        {loaded && list.length === 0 && (
          <div className="col-span-full bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-400">
            No {subtype} accounts yet.
          </div>
        )}
      </div>

      {opening?.locked && <p className="text-[11px] text-slate-400 mt-3">Opening balances are locked — corrections now go through adjusting journal entries.</p>}

      {modal?.kind === "create" && <CreateModal subtype={subtype} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
      {modal?.kind === "opening" && (
        <OpeningModal account={modal.account} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); loadOpening(); }} />
      )}
    </div>
  );
}

function CreateModal({ subtype, onClose, onSaved }: { subtype: "cash" | "bank"; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name,
        type: "asset",
        subtype,
        metadata: subtype === "bank" ? { nickname: nickname || name, currency } : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not create");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">Add {subtype} account</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Account number</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={subtype === "cash" ? "1020" : "1110"} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={subtype === "cash" ? "Register 2" : "Chase Checking"} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          {subtype === "bank" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Nickname</label>
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Main account" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Currency</label>
                <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OpeningModal({ account, onClose, onSaved }: { account: UiAccount; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [asOfDate, setAsOfDate] = useState(todayInput());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/opening-balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set", accountId: account.id, amount: Number(amount), asOfDate }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not set opening balance");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">Opening balance</h2>
        <p className="text-xs text-slate-400 mb-4">{account.code} — {account.name}. Posts against Opening Balance Equity.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Amount</label>
            <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">As of</label>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Posting…" : "Set opening balance"}
          </button>
        </div>
      </div>
    </div>
  );
}
