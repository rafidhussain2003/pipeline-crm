"use client";

import { useEffect, useState } from "react";
import { AccountSelect, money, moneyNum, PageHeader, StatusBadge, todayInput, useAccounts, useFinanceCurrency } from "@/components/finance/shared";

type JournalRow = { id: string; entryNumber: number | null; entryDate: string; memo: string | null; status: "draft" | "posted" | "voided"; sourceType: string; total: string };
type JournalDetail = JournalRow & { lines: { id: string; accountCode: string; accountName: string; debit: string; credit: string; description: string | null }[]; voidReason: string | null };
type EditorLine = { accountId: string; side: "debit" | "credit"; amount: string; description: string };

export default function JournalPage() {
  useFinanceCurrency();
  const { accounts } = useAccounts();
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [filter, setFilter] = useState("");
  const [editor, setEditor] = useState<null | { id?: string }>(null);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch(`/api/finance/journals${filter ? `?status=${filter}` : ""}`);
    if (res.ok) setRows((await res.json()).journals || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  async function open(id: string) {
    const res = await fetch(`/api/finance/journals/${id}`);
    if (res.ok) setDetail((await res.json()).journal);
  }

  async function action(id: string, action: "post" | "void") {
    setError("");
    const res = await fetch(`/api/finance/journals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Action failed");
    setDetail(null);
    load();
  }

  async function discard(id: string) {
    setError("");
    const res = await fetch(`/api/finance/journals/${id}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not delete draft");
    setDetail(null);
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Journal Entries"
        subtitle="Manual double-entry records. Drafts are editable; posted entries are permanent and correct only by reversal."
        action={<button onClick={() => setEditor({})} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">New journal entry</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="flex gap-1.5 mb-3">
        {["", "draft", "posted", "voided"].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`text-xs font-medium rounded-full px-3 py-1 capitalize ${filter === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
            {s || "All"}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((j) => (
          <button key={j.id} onClick={() => open(j.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <span className="text-xs font-mono text-slate-400 w-16 shrink-0">{j.entryNumber ? `JE-${j.entryNumber}` : "—"}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{j.memo || j.sourceType}</div>
              <div className="text-xs text-slate-400">{j.entryDate} · {j.sourceType}</div>
            </div>
            <StatusBadge status={j.status} />
            <span className="text-sm font-semibold text-slate-900 w-24 text-right">{moneyNum(j.total)}</span>
          </button>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No journal entries yet.</p>}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-slate-900">{detail.entryNumber ? `JE-${detail.entryNumber}` : "Draft entry"}</h2>
              <StatusBadge status={detail.status} />
            </div>
            <p className="text-xs text-slate-400 mb-3">{detail.entryDate}{detail.memo ? ` · ${detail.memo}` : ""}{detail.voidReason ? ` · ${detail.voidReason}` : ""}</p>
            <div className="border border-slate-200 rounded-md divide-y divide-slate-100 mb-4">
              {detail.lines.map((l) => (
                <div key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-slate-400 w-12">{l.accountCode}</span>
                  <span className="flex-1 min-w-0 truncate text-slate-800">{l.accountName}{l.description ? <span className="text-slate-400"> — {l.description}</span> : null}</span>
                  <span className="w-24 text-right text-slate-900">{Number(l.debit) > 0 ? moneyNum(l.debit) : ""}</span>
                  <span className="w-24 text-right text-slate-900">{Number(l.credit) > 0 ? moneyNum(l.credit) : ""}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              {detail.status === "draft" && (
                <>
                  <button onClick={() => discard(detail.id)} className="text-sm font-medium text-red-600 px-3 py-2 rounded-md hover:bg-red-50">Delete draft</button>
                  <button onClick={() => { setEditor({ id: detail.id }); setDetail(null); }} className="text-sm font-medium text-slate-600 px-3 py-2 rounded-md hover:bg-slate-50">Edit</button>
                  <button onClick={() => action(detail.id, "post")} className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-md">Post</button>
                </>
              )}
              {detail.status === "posted" && (
                <button onClick={() => action(detail.id, "void")} className="text-sm font-medium text-red-600 px-3 py-2 rounded-md hover:bg-red-50">Void (creates reversal)</button>
              )}
              <button onClick={() => setDetail(null)} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {editor && (
        <JournalEditor
          accounts={accounts}
          journalId={editor.id}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}
    </div>
  );
}

function JournalEditor({ accounts, journalId, onClose, onSaved }: { accounts: ReturnType<typeof useAccounts>["accounts"]; journalId?: string; onClose: () => void; onSaved: () => void }) {
  const [entryDate, setEntryDate] = useState(todayInput());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<EditorLine[]>([
    { accountId: "", side: "debit", amount: "", description: "" },
    { accountId: "", side: "credit", amount: "", description: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Editing an existing draft: hydrate from the server.
  useEffect(() => {
    if (!journalId) return;
    fetch(`/api/finance/journals/${journalId}`).then(async (r) => {
      if (!r.ok) return;
      const j = (await r.json()).journal as JournalDetail & { lines: { accountId?: string; debit: string; credit: string; description: string | null }[] };
      setEntryDate(j.entryDate);
      setMemo(j.memo || "");
      setLines(
        j.lines.map((l) => ({
          accountId: (l as { accountId?: string }).accountId || "",
          side: Number(l.debit) > 0 ? "debit" : "credit",
          amount: Number(l.debit) > 0 ? l.debit : l.credit,
          description: l.description || "",
        })),
      );
    });
  }, [journalId]);

  const cents = (s: string) => Math.round(Number(s || 0) * 100);
  const debitTotal = lines.filter((l) => l.side === "debit").reduce((s, l) => s + cents(l.amount), 0);
  const creditTotal = lines.filter((l) => l.side === "credit").reduce((s, l) => s + cents(l.amount), 0);
  const balanced = debitTotal === creditTotal && debitTotal > 0;

  function setLine(i: number, patch: Partial<EditorLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function save(post: boolean) {
    setSaving(true);
    setError("");
    const payload = {
      entryDate,
      memo: memo || null,
      lines: lines
        .filter((l) => l.accountId && cents(l.amount) > 0)
        .map((l) => ({ accountId: l.accountId, [l.side]: Number(l.amount), description: l.description || null })),
    };
    const res = journalId
      ? await fetch(`/api/finance/journals/${journalId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/finance/journals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      setSaving(false);
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      return;
    }
    if (post) {
      const saved = (await res.json()).journal;
      const postRes = await fetch(`/api/finance/journals/${saved.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "post" }) });
      if (!postRes.ok) {
        setSaving(false);
        setError((await postRes.json().catch(() => ({}))).error || "Saved as draft, but posting failed");
        return;
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">{journalId ? "Edit draft entry" : "New journal entry"}</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Memo</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What is this entry for?" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="space-y-2 mb-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_110px_1fr_28px] gap-2 items-center">
              <AccountSelect accounts={accounts} value={l.accountId} onChange={(id) => setLine(i, { accountId: id })} placeholder="Account…" />
              <select value={l.side} onChange={(e) => setLine(i, { side: e.target.value as "debit" | "credit" })} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
              <input type="number" step="0.01" min="0" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="0.00" className="rounded-md border border-slate-200 px-2 py-2 text-sm text-right" />
              <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Line note (optional)" className="rounded-md border border-slate-200 px-2 py-2 text-sm" />
              <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 2} className="text-slate-300 hover:text-red-500 disabled:opacity-30 text-lg leading-none">×</button>
            </div>
          ))}
        </div>
        <button onClick={() => setLines((ls) => [...ls, { accountId: "", side: "debit", amount: "", description: "" }])} className="text-xs font-medium text-blue-600 mb-3">+ Add line</button>

        <div className={`text-xs rounded-md px-3 py-2 mb-3 ${balanced ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"}`}>
          Debits {money(debitTotal)} · Credits {money(creditTotal)} — {balanced ? "balanced" : "must balance before posting"}
        </div>
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={() => save(false)} disabled={saving} className="text-sm font-medium text-slate-700 bg-slate-100 px-4 py-2 rounded-md disabled:opacity-50">Save draft</button>
          <button onClick={() => save(true)} disabled={saving || !balanced} className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : "Save & post"}
          </button>
        </div>
      </div>
    </div>
  );
}
