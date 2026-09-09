"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountSelect, moneyNum, PageHeader, StatusBadge, todayInput, useAccounts, useFinanceCurrency } from "@/components/finance/shared";

type Expense = {
  id: string; docNumber: number; entryDate: string; vendorName: string; category: string | null; docType: string;
  paymentMethod: string; receiptRef: string | null; amount: string; status: string; notes: string | null;
};
type Bucket = { label: string; total: number; count: number };
// Server-computed per-month totals (exact: every posted entry, voided excluded,
// regardless of the list page size), classified three ways.
type MonthSummary = { month: string; total: number; count: number; byCategory: Bucket[]; byMethod: Bucket[]; byType: Bucket[] };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTH_NAMES[m - 1]} ${y}` : ym;
}
const TYPE_LABEL: Record<string, string> = { expense: "Business expense", payout: "Customer payout", salary: "Salary" };
const LIST_LIMIT = 200;

function Chips({ title, items, cap }: { title: string; items: Bucket[]; cap?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mr-0.5">{title}</span>
      {items.map((b) => (
        <span key={b.label} className={`text-[11px] text-slate-600 bg-slate-100 rounded-full px-2.5 py-1 ${cap ? "capitalize" : ""}`}>
          {b.label} <strong className="text-slate-900">{moneyNum(b.total)}</strong>
        </span>
      ))}
    </div>
  );
}

export default function ExpensesPage() {
  useFinanceCurrency();
  const { accounts } = useAccounts();
  const [rows, setRows] = useState<Expense[]>([]);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const [month, setMonth] = useState<string | null>(null); // null = undecided, "" = all months
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  // Workspace quick actions land here with ?docType=payout / salary (or the
  // legacy ?category=…) — open the form pre-filled so a payout/salary is one
  // click away. docType drives the capability gate + the document label.
  const searchParams = useSearchParams();
  const presetCategory = searchParams.get("category") || "";
  const presetDocType = searchParams.get("docType") || "expense";
  useEffect(() => {
    if (presetCategory || searchParams.get("docType")) setShowForm(true);
  }, [presetCategory, searchParams]);

  const loadSummary = async () => {
    const res = await fetch("/api/finance/expenses/summary");
    if (!res.ok) return;
    const list: MonthSummary[] = (await res.json()).months || [];
    setMonths(list);
    setMonth((m) => (m === null ? (list[0]?.month ?? "") : m));
  };
  const loadRows = async (m: string) => {
    const p = new URLSearchParams({ limit: String(LIST_LIMIT) });
    if (m) p.set("month", m);
    const res = await fetch(`/api/finance/expenses?${p}`);
    if (res.ok) setRows((await res.json()).expenses || []);
  };
  const reload = async () => { await loadSummary(); if (month !== null) await loadRows(month); };

  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { if (month !== null) loadRows(month); }, [month]);

  async function voidDoc(id: string) {
    setError("");
    const res = await fetch(`/api/finance/expenses/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not void");
    reload();
  }

  const summaryFor = (m: string) => months.find((x) => x.month === m);
  const grandTotal = months.reduce((s, m) => s + m.total, 0);
  const grouped = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const r of rows) {
      const k = r.entryDate.slice(0, 7);
      const arr = map.get(k);
      if (arr) arr.push(r); else map.set(k, [r]);
    }
    return map;
  }, [rows]);
  const sectionMonths = month ? [month] : [...new Set([...months.map((m) => m.month), ...grouped.keys()])].sort().reverse();

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Expenses"
        subtitle="Money spent. Each entry posts a balanced journal automatically (debit expense, credit cash/bank)."
        action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Record expense</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={month ?? ""} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="rounded-md border border-slate-200 px-3 py-2 text-sm bg-white">
          <option value="">All months</option>
          {months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)} · {moneyNum(m.total)}</option>)}
        </select>
        <span className="text-xs text-slate-500">
          {month
            ? <>Total for {monthLabel(month)}: <strong className="text-slate-900">{moneyNum(summaryFor(month)?.total ?? 0)}</strong> · {summaryFor(month)?.count ?? 0} entries</>
            : <>All time: <strong className="text-slate-900">{moneyNum(grandTotal)}</strong> across {months.length} month{months.length === 1 ? "" : "s"}</>}
        </span>
      </div>

      {sectionMonths.map((m) => {
        const s = summaryFor(m);
        const list = grouped.get(m) ?? [];
        const count = s?.count ?? list.length;
        return (
          <section key={m} className="mb-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <h2 className="text-sm font-semibold text-slate-800">{monthLabel(m)}</h2>
              <span className="text-sm font-semibold text-red-700">
                {moneyNum(s?.total ?? 0)} <span className="text-xs font-normal text-slate-400">· {count} {count === 1 ? "entry" : "entries"}</span>
              </span>
            </div>
            {s && (
              <div className="space-y-1.5 mb-2">
                <Chips title="By category" items={s.byCategory} cap />
                <Chips title="By type" items={s.byType.map((b) => ({ ...b, label: TYPE_LABEL[b.label] || b.label }))} />
                <Chips title="Paid via" items={s.byMethod} cap />
              </div>
            )}
            <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
              {list.map((r) => (
                <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.status === "voided" ? "opacity-50" : ""}`}>
                  <span className="text-xs font-mono text-slate-400 w-16 shrink-0">EX-{r.docNumber}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{r.vendorName}</div>
                    <div className="text-xs text-slate-400 capitalize">
                      {r.entryDate} · {r.paymentMethod}{r.category ? ` · ${r.category}` : ""}{r.docType && r.docType !== "expense" ? ` · ${TYPE_LABEL[r.docType] || r.docType}` : ""}{r.receiptRef ? ` · Receipt ${r.receiptRef}` : ""}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                  <span className="text-sm font-semibold text-slate-900 w-24 text-right">{moneyNum(r.amount)}</span>
                  <a href={`/api/finance/expenses/${r.id}/receipt`} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2 py-1">Receipt</a>
                  {r.status === "posted" && (
                    <button onClick={() => voidDoc(r.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Void</button>
                  )}
                </div>
              ))}
              {list.length === 0 && <p className="text-sm text-slate-400 px-4 py-6 text-center">{month ? "No expenses recorded in this month." : "No entries loaded for this month."}</p>}
              {list.length > 0 && (
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 text-xs">
                  <span className="text-slate-500">{monthLabel(m)} total (posted)</span>
                  <span className="font-semibold text-slate-900">{moneyNum(s?.total ?? 0)}</span>
                </div>
              )}
            </div>
          </section>
        );
      })}
      {sectionMonths.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-lg"><p className="text-sm text-slate-400 px-4 py-8 text-center">No expenses recorded yet.</p></div>
      )}
      {!month && rows.length >= LIST_LIMIT && (
        <p className="text-xs text-slate-400 mb-4">Showing the latest {LIST_LIMIT} entries across months. Monthly totals above are exact; pick a month to see all of its entries.</p>
      )}

      {showForm && <ExpenseModal accounts={accounts} presetCategory={presetCategory} docType={presetDocType} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload(); }} />}
    </div>
  );
}

const DOC_TYPE_TITLE: Record<string, string> = { expense: "Record expense", payout: "Record customer payout", salary: "Record salary payment" };

function ExpenseModal({ accounts, presetCategory, docType = "expense", onClose, onSaved }: { accounts: ReturnType<typeof useAccounts>["accounts"]; presetCategory?: string; docType?: string; onClose: () => void; onSaved: () => void }) {
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
        entryDate, vendorName, category: category || null, docType, paymentMethod, receiptRef: receiptRef || null,
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
        <h2 className="text-base font-semibold text-slate-900 mb-4">{DOC_TYPE_TITLE[docType] || "Record expense"}</h2>
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
