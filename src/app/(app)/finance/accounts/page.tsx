"use client";

import { useState } from "react";
import { money, PageHeader, useAccounts, useFinanceCurrency, type UiAccount } from "@/components/finance/shared";

const TYPE_LABELS: Record<string, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
const TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export default function ChartOfAccountsPage() {
  useFinanceCurrency();
  const { accounts, loaded, reload } = useAccounts();
  const [modal, setModal] = useState<null | { edit?: UiAccount }>(null);
  const [error, setError] = useState("");

  async function act(fn: () => Promise<Response>) {
    setError("");
    const res = await fn();
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Something went wrong");
      return false;
    }
    reload();
    return true;
  }

  const remove = (a: UiAccount) => act(() => fetch(`/api/finance/accounts/${a.id}`, { method: "DELETE" }));
  const toggleActive = (a: UiAccount) =>
    act(() => fetch(`/api/finance/accounts/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !a.active }) }));

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Chart of Accounts"
        subtitle="Every account your books post to, grouped by type. Balances come from the posted ledger."
        action={<button onClick={() => setModal({})} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add account</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      {!loaded && <p className="text-sm text-slate-400">Loading…</p>}

      {TYPES.map((type) => {
        const group = accounts.filter((a) => a.type === type);
        if (group.length === 0) return null;
        const parents = group.filter((a) => !a.parentId);
        const childrenOf = (id: string) => group.filter((a) => a.parentId === id);
        const row = (a: UiAccount, depth: number) => (
          <div key={a.id} className={`flex items-center gap-3 py-2 border-b border-slate-100 last:border-0 ${a.active ? "" : "opacity-50"}`}>
            <span className="text-xs font-mono text-slate-400 w-16 shrink-0" style={{ paddingLeft: depth * 16 }}>{a.code}</span>
            <span className="text-sm text-slate-800 flex-1 min-w-0 truncate">
              {a.name}
              {a.subtype && <span className="ml-1.5 text-[10px] font-semibold uppercase text-sky-600">{a.subtype}</span>}
              {a.isSystem && <span className="ml-1.5 text-[10px] font-semibold uppercase text-slate-400">System</span>}
              {!a.active && <span className="ml-1.5 text-[10px] font-semibold uppercase text-amber-600">Inactive</span>}
            </span>
            <span className="text-sm font-medium text-slate-900 w-28 text-right">{money(a.balanceCents)}</span>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setModal({ edit: a })} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">Edit</button>
              {!a.isSystem && (
                <button onClick={() => toggleActive(a)} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">
                  {a.active ? "Deactivate" : "Activate"}
                </button>
              )}
              {!a.isSystem && a.balanceCents === 0 && (
                <button onClick={() => remove(a)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>
              )}
            </div>
          </div>
        );
        return (
          <div key={type} className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{TYPE_LABELS[type]}</h2>
            {parents.map((p) => [row(p, 0), ...childrenOf(p.id).map((c) => row(c, 1))])}
          </div>
        );
      })}

      {modal && <AccountModal accounts={accounts} edit={modal.edit} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />}
    </div>
  );
}

function AccountModal({ accounts, edit, onClose, onSaved }: { accounts: UiAccount[]; edit?: UiAccount; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(edit?.code || "");
  const [name, setName] = useState(edit?.name || "");
  const [type, setType] = useState<string>(edit?.type || "expense");
  const [subtype, setSubtype] = useState<string>(edit?.subtype || "");
  const [parentId, setParentId] = useState(edit?.parentId || "");
  const [description, setDescription] = useState(edit?.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = edit
      ? await fetch(`/api/finance/accounts/${edit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: description || null, parentId: parentId || null }),
        })
      : await fetch("/api/finance/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, name, type, subtype: subtype || null, parentId: parentId || null, description: description || null }),
        });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not save");
      return;
    }
    onSaved();
  }

  const parentOptions = accounts.filter((a) => a.type === type && a.id !== edit?.id && !a.parentId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">{edit ? `Edit ${edit.code}` : "Add account"}</h2>
        <div className="space-y-3">
          {!edit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Account number</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="5400" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
                <select value={type} onChange={(e) => { setType(e.target.value); setParentId(""); setSubtype(""); }} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketing" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {!edit && type === "asset" && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Kind</label>
              <select value={subtype} onChange={(e) => setSubtype(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="">Regular asset</option>
                <option value="cash">Cash account</option>
                <option value="bank">Bank account</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Parent account (optional)</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">None</option>
              {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description (optional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
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
