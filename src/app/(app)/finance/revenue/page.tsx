"use client";

import { useEffect, useMemo, useState } from "react";
import { AccountSelect, moneyNum, PageHeader, StatusBadge, todayInput, useAccounts, useFinanceCurrency } from "@/components/finance/shared";
import { ClientModal, clientAddress, type Client } from "@/components/finance/ClientModal";

type Revenue = {
  id: string; docNumber: number; entryDate: string; customerName: string; invoiceRef: string | null;
  amount: string; status: string; notes: string | null;
  clientId: string | null; invoiceNumber: string | null; invoiceDate: string | null; invoiceCurrency: string | null;
  invoiceAmount: string | null; servicePeriod: string | null; serviceDescription: string | null;
};
// Server-computed per-month totals (exact: every posted entry, voided excluded,
// regardless of the list page size) with a breakdown by income account.
type MonthSummary = { month: string; total: number; count: number; byAccount: { label: string; total: number; count: number }[] };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${MONTH_NAMES[m - 1]} ${y}` : ym;
}
const LIST_LIMIT = 200;

export default function RevenuePage() {
  const currency = useFinanceCurrency();
  const { accounts } = useAccounts();
  const [rows, setRows] = useState<Revenue[]>([]);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  // null = not decided yet; "" = all months (a section per month); else one YYYY-MM.
  const [month, setMonth] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [invoicing, setInvoicing] = useState<Revenue | null>(null); // row whose invoice details are open
  const [renumbering, setRenumbering] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = async () => {
    const res = await fetch("/api/finance/revenues/summary");
    if (!res.ok) return;
    const list: MonthSummary[] = (await res.json()).months || [];
    setMonths(list);
    // First visit opens on the most recent month that has entries.
    setMonth((m) => (m === null ? (list[0]?.month ?? "") : m));
  };
  const loadRows = async (m: string) => {
    const p = new URLSearchParams({ limit: String(LIST_LIMIT) });
    if (m) p.set("month", m);
    const res = await fetch(`/api/finance/revenues?${p}`);
    if (res.ok) setRows((await res.json()).revenues || []);
  };
  const reload = async () => { await loadSummary(); if (month !== null) await loadRows(month); };

  useEffect(() => { loadSummary(); }, []);
  useEffect(() => { if (month !== null) loadRows(month); }, [month]);

  async function voidDoc(id: string) {
    if (!confirm("Void this revenue entry? A reversing journal is posted. You can unvoid it later.")) return;
    setError("");
    const res = await fetch(`/api/finance/revenues/${id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not void");
    reload();
  }
  async function unvoidDoc(id: string) {
    if (!confirm("Unvoid this revenue entry? It is reinstated in the books on its original date and its invoice becomes valid again.")) return;
    setError("");
    const res = await fetch(`/api/finance/revenues/${id}/unvoid`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not unvoid");
    reload();
  }

  const summaryFor = (m: string) => months.find((x) => x.month === m);
  const grandTotal = months.reduce((s, m) => s + m.total, 0);
  // Group the loaded rows by calendar month for the "All months" view.
  const grouped = useMemo(() => {
    const map = new Map<string, Revenue[]>();
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
        title="Revenue"
        subtitle="Money received. Each entry posts a balanced journal automatically (debit cash/bank, credit income)."
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setRenumbering(true)} title="Re-assign invoice numbers in date order" className="text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-md">Renumber invoices</button>
            <button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Record revenue</button>
          </div>
        }
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      {/* Month picker + totals strip */}
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
              <span className="text-sm font-semibold text-emerald-700">
                {moneyNum(s?.total ?? 0)} <span className="text-xs font-normal text-slate-400">· {count} {count === 1 ? "entry" : "entries"}</span>
              </span>
            </div>
            {s && s.byAccount.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mr-0.5">By income account</span>
                {s.byAccount.map((b) => (
                  <span key={b.label} className="text-[11px] text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">
                    {b.label} <strong className="text-slate-900">{moneyNum(b.total)}</strong>
                  </span>
                ))}
              </div>
            )}
            <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
              {list.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`text-xs font-mono text-slate-400 w-16 shrink-0 ${r.status === "voided" ? "opacity-50" : ""}`}>RV-{r.docNumber}</span>
                  <div
                    className={`flex-1 min-w-0 ${r.status === "posted" ? "cursor-pointer" : "opacity-50"}`}
                    role={r.status === "posted" ? "button" : undefined}
                    tabIndex={r.status === "posted" ? 0 : undefined}
                    title={r.status === "posted" ? (r.invoiceNumber ? "Edit invoice details" : "Select client & create invoice") : undefined}
                    onClick={() => { if (r.status === "posted") setInvoicing(r); }}
                    onKeyDown={(e) => { if (r.status === "posted" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setInvoicing(r); } }}
                  >
                    <div className="text-sm font-medium text-slate-900 truncate">{r.customerName}</div>
                    <div className="text-xs text-slate-400">
                      Received {r.entryDate}
                      {r.invoiceNumber ? ` · ${r.invoiceNumber}` : r.invoiceRef ? ` · Invoice ${r.invoiceRef}` : ""}
                      {r.servicePeriod ? ` · ${r.servicePeriod}` : ""}
                      {r.invoiceAmount && r.invoiceCurrency && r.invoiceCurrency !== currency ? ` · ${r.invoiceCurrency} ${Number(r.invoiceAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                  <span className={`text-sm font-semibold text-slate-900 w-24 text-right ${r.status === "voided" ? "line-through opacity-50" : ""}`}>{moneyNum(r.amount)}</span>
                  {r.invoiceNumber ? (
                    <>
                      <a href={`/api/finance/revenues/${r.id}/invoice`} className="text-[11px] font-medium text-white bg-slate-900 hover:bg-slate-700 rounded px-2 py-1">Invoice</a>
                      {r.status === "posted" && (
                        <button onClick={() => setInvoicing(r)} title="Edit invoice details and download the updated PDF" className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2 py-1">Edit</button>
                      )}
                    </>
                  ) : r.status === "posted" ? (
                    <button onClick={() => setInvoicing(r)} className="text-[11px] font-medium text-slate-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded px-2 py-1">Create invoice</button>
                  ) : (
                    <a href={`/api/finance/revenues/${r.id}/receipt`} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2 py-1">Receipt</a>
                  )}
                  {r.status === "posted" && (
                    <button onClick={() => voidDoc(r.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Void</button>
                  )}
                  {r.status === "voided" && (
                    <button onClick={() => unvoidDoc(r.id)} title="Reinstate this entry in the books" className="text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded px-2 py-1">Unvoid</button>
                  )}
                </div>
              ))}
              {list.length === 0 && <p className="text-sm text-slate-400 px-4 py-6 text-center">{month ? "No revenue recorded in this month." : "No entries loaded for this month."}</p>}
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
        <div className="bg-white border border-slate-200 rounded-lg"><p className="text-sm text-slate-400 px-4 py-8 text-center">No revenue recorded yet.</p></div>
      )}
      {!month && rows.length >= LIST_LIMIT && (
        <p className="text-xs text-slate-400 mb-4">Showing the latest {LIST_LIMIT} entries across months. Monthly totals above are exact; pick a month to see all of its entries.</p>
      )}

      {showForm && <RevenueModal accounts={accounts} baseCurrency={currency} onClose={() => setShowForm(false)} onSaved={() => reload()} />}
      {invoicing && <InvoiceDetailsModal revenue={invoicing} baseCurrency={currency} onClose={() => setInvoicing(null)} onSaved={() => reload()} />}
      {renumbering && <RenumberModal onClose={() => setRenumbering(false)} onApplied={() => reload()} />}
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "2026-07" (month input) → "July 2026" (what the invoice prints).
function periodLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return y && m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : "";
}
function lastMonthInput(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function RevenueModal({ accounts, baseCurrency, onClose, onSaved }: { accounts: ReturnType<typeof useAccounts>["accounts"]; baseCurrency: string; onClose: () => void; onSaved: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [newClient, setNewClient] = useState(false);
  const [entryDate, setEntryDate] = useState(todayInput()); // payment received
  const [invoiceDate, setInvoiceDate] = useState(todayInput());
  const [invoiceDateTouched, setInvoiceDateTouched] = useState(false);
  const [period, setPeriod] = useState(lastMonthInput());
  const [description, setDescription] = useState("");
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [invoiceCurrency, setInvoiceCurrency] = useState("USD");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [amount, setAmount] = useState(""); // base-currency amount received
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const [depositAccountId, setDepositAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [posted, setPosted] = useState<{ id: string; invoiceNumber: string | null; docNumber: number } | null>(null);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const sameCurrency = invoiceCurrency.toUpperCase() === baseCurrency;

  useEffect(() => {
    fetch("/api/finance/clients").then(async (r) => { if (r.ok) setClients((await r.json()).clients || []); });
  }, []);
  // Picking a client pre-fills its invoicing defaults.
  useEffect(() => {
    if (!client) return;
    setInvoiceCurrency(client.invoiceCurrency);
    if (!descriptionTouched) setDescription(`${client.serviceDescription} for ${periodLabel(period)}`.trim());
  }, [client, period, descriptionTouched]);

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/revenues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        entryDate,
        invoiceDate,
        servicePeriod: periodLabel(period),
        serviceDescription: description,
        invoiceCurrency,
        invoiceAmount: Number(invoiceAmount),
        amount: Number(sameCurrency ? invoiceAmount : amount),
        incomeAccountId,
        depositAccountId,
        notes: notes || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      return;
    }
    const { revenue } = await res.json();
    setPosted({ id: revenue.id, invoiceNumber: revenue.invoiceNumber ?? null, docNumber: revenue.docNumber });
    onSaved();
  }

  if (newClient) {
    return <ClientModal client={null} onClose={() => setNewClient(false)} onSaved={(c) => { setClients((list) => [...list, c].sort((a, b) => a.name.localeCompare(b.name))); setClientId(c.id); setNewClient(false); }} />;
  }

  if (posted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl mb-3">✓</div>
          <h2 className="text-base font-semibold text-slate-900">Revenue posted</h2>
          <p className="text-sm text-slate-500 mt-1">
            RV-{posted.docNumber}{posted.invoiceNumber ? <> · Invoice <strong className="text-slate-900">{posted.invoiceNumber}</strong> generated.</> : null}
          </p>
          <div className="flex justify-center gap-2 mt-5">
            {posted.invoiceNumber && (
              <a href={`/api/finance/revenues/${posted.id}/invoice`} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Download invoice (PDF)</a>
            )}
            <button onClick={onClose} className="text-sm font-medium text-slate-600 bg-slate-100 px-4 py-2 rounded-md">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">Record revenue</h2>
        <p className="text-xs text-slate-500 mb-4">Posting generates the tax invoice (export under LUT) for the selected client.</p>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-600">Client <span className="text-red-500">*</span></label>
              <button type="button" onClick={() => setNewClient(true)} className="text-[11px] font-medium text-blue-700 hover:underline">+ New client</button>
            </div>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white">
              <option value="">Select the company that paid…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {client && (
              <div className="mt-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
                <div className="font-semibold text-slate-900">{client.name}</div>
                <div>{clientAddress(client)}</div>
                <div>Country: {client.country}{client.gstin ? ` · GSTIN ${client.gstin}` : ""}</div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Revenue received date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => { setEntryDate(e.target.value); if (!invoiceDateTouched) setInvoiceDate(e.target.value); }}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-slate-400 mt-1">The day the money arrived. Printed as &quot;Payment received&quot; and used as the entry date in the books.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Invoice date</label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => { setInvoiceDate(e.target.value); setInvoiceDateTouched(true); }}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-slate-400 mt-1">Follows the received date unless you change it.</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Service period <span className="text-red-500">*</span></label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description of services</label>
            <input value={description} onChange={(e) => { setDescription(e.target.value); setDescriptionTouched(true); }} placeholder="BPO Services for July 2026" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-[88px_1fr] gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Currency</label>
              <input value={invoiceCurrency} onChange={(e) => setInvoiceCurrency(e.target.value.toUpperCase())} maxLength={3} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Invoice amount ({invoiceCurrency || "…"}) <span className="text-red-500">*</span></label>
              <input type="number" step="0.01" min="0.01" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} placeholder="104.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          {!sameCurrency && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Amount received in {baseCurrency} <span className="text-red-500">*</span></label>
              <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="9440.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              <p className="text-[11px] text-slate-400 mt-1">What actually landed in the bank after conversion — this is the figure posted to the books and printed as &quot;{baseCurrency} equivalent received&quot;.</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Income account</label>
            <AccountSelect accounts={accounts} value={incomeAccountId} onChange={setIncomeAccountId} filter={(a) => a.type === "income"} placeholder="Which income is this?" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Deposited into</label>
            <AccountSelect accounts={accounts} value={depositAccountId} onChange={setDepositAccountId} filter={(a) => a.type === "asset" && (a.subtype === "cash" || a.subtype === "bank")} placeholder="Cash or bank account" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes (optional, not printed)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving || !clientId} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Posting…" : "Post & generate invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

// "2026-07-15" → "2026-07" for the month input; "July 2026" → "2026-07" when
// re-opening an entry that already has a service period.
function monthInputFrom(rev: Revenue): string {
  if (rev.servicePeriod) {
    const [name, year] = rev.servicePeriod.split(" ");
    const m = MONTHS.indexOf(name);
    if (m >= 0 && /^\d{4}$/.test(year || "")) return `${year}-${String(m + 1).padStart(2, "0")}`;
  }
  // Default: the month before the payment landed (services are billed in arrears).
  const d = new Date(`${rev.entryDate}T00:00:00`);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Attach a client + invoice details to an already-posted entry (or correct
// them). The amount received and the books are untouched; the invoice number
// is allocated the first time and kept afterwards.
function InvoiceDetailsModal({ revenue, baseCurrency, onClose, onSaved }: { revenue: Revenue; baseCurrency: string; onClose: () => void; onSaved: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(revenue.clientId ?? "");
  const [newClient, setNewClient] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(revenue.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(revenue.invoiceDate ?? revenue.entryDate);
  const [period, setPeriod] = useState(() => monthInputFrom(revenue));
  const [description, setDescription] = useState(revenue.serviceDescription ?? "");
  const [descriptionTouched, setDescriptionTouched] = useState(!!revenue.serviceDescription);
  const [invoiceCurrency, setInvoiceCurrency] = useState(revenue.invoiceCurrency ?? "");
  const [invoiceAmount, setInvoiceAmount] = useState(revenue.invoiceAmount ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ invoiceNumber: string } | null>(null);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const sameCurrency = (invoiceCurrency || "").toUpperCase() === baseCurrency;

  useEffect(() => {
    fetch("/api/finance/clients").then(async (r) => {
      if (!r.ok) return;
      const list: Client[] = (await r.json()).clients || [];
      setClients(list);
      // Entry recorded by free-text name: pre-select a client with the same name.
      if (!revenue.clientId) {
        const match = list.find((c) => c.name.trim().toLowerCase() === revenue.customerName.trim().toLowerCase());
        if (match) setClientId(match.id);
      }
    });
  }, [revenue.clientId, revenue.customerName]);
  useEffect(() => {
    if (!client) return;
    if (!revenue.invoiceCurrency) setInvoiceCurrency(client.invoiceCurrency);
    if (!descriptionTouched) setDescription(`${client.serviceDescription} for ${periodLabel(period)}`.trim());
  }, [client, period, descriptionTouched, revenue.invoiceCurrency]);
  // Same currency as the books → the invoice amount is simply the amount received.
  useEffect(() => {
    if (sameCurrency && !revenue.invoiceAmount) setInvoiceAmount(revenue.amount);
  }, [sameCurrency, revenue.invoiceAmount, revenue.amount]);

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/finance/revenues/${revenue.id}/invoice`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, invoiceNumber: revenue.invoiceNumber ? invoiceNumber : null, invoiceDate, servicePeriod: periodLabel(period), serviceDescription: description, invoiceCurrency, invoiceAmount: Number(invoiceAmount) }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      return;
    }
    const { revenue: updated } = await res.json();
    setSaved({ invoiceNumber: updated.invoiceNumber });
    onSaved();
  }

  if (newClient) {
    return <ClientModal client={null} onClose={() => setNewClient(false)} onSaved={(c) => { setClients((list) => [...list, c].sort((a, b) => a.name.localeCompare(b.name))); setClientId(c.id); setNewClient(false); }} />;
  }

  if (saved) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl mb-3">✓</div>
          <h2 className="text-base font-semibold text-slate-900">{revenue.invoiceNumber ? "Invoice updated" : "Invoice ready"}</h2>
          <p className="text-sm text-slate-500 mt-1">RV-{revenue.docNumber} · Invoice <strong className="text-slate-900">{saved.invoiceNumber}</strong>{revenue.invoiceNumber ? " — download the new PDF below." : ""}</p>
          <div className="flex justify-center gap-2 mt-5">
            <a href={`/api/finance/revenues/${revenue.id}/invoice`} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Download invoice (PDF)</a>
            <button onClick={onClose} className="text-sm font-medium text-slate-600 bg-slate-100 px-4 py-2 rounded-md">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">{revenue.invoiceNumber ? `Invoice ${revenue.invoiceNumber}` : "Create invoice"}</h2>
        <p className="text-xs text-slate-500 mb-4">
          RV-{revenue.docNumber} · received {revenue.entryDate} · {moneyNum(revenue.amount)}. The posted amount and date stay as they are; this only sets what the invoice prints.
        </p>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-600">Client <span className="text-red-500">*</span></label>
              <button type="button" onClick={() => setNewClient(true)} className="text-[11px] font-medium text-blue-700 hover:underline">+ New client</button>
            </div>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white">
              <option value="">Select the company that paid…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!revenue.clientId && !client && (
              <p className="text-[11px] text-slate-400 mt-1">Recorded as &quot;{revenue.customerName}&quot;. Pick the matching client, or add it.</p>
            )}
            {client && (
              <div className="mt-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
                <div className="font-semibold text-slate-900">{client.name}</div>
                <div>{clientAddress(client)}</div>
                <div>Country: {client.country}{client.gstin ? ` · GSTIN ${client.gstin}` : ""}</div>
              </div>
            )}
          </div>
          {revenue.invoiceNumber && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Invoice number</label>
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} maxLength={40} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono" />
                <p className="text-[11px] text-slate-400 mt-1">Must be unique. Change only to align with your records.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Invoice date</label>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Service period <span className="text-red-500">*</span></label>
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            {!revenue.invoiceNumber && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Invoice date</label>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description of services</label>
            <input value={description} onChange={(e) => { setDescription(e.target.value); setDescriptionTouched(true); }} placeholder="BPO Services for July 2026" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-[88px_1fr] gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Currency</label>
              <input value={invoiceCurrency} onChange={(e) => setInvoiceCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="USD" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Invoice amount ({invoiceCurrency || "…"}) <span className="text-red-500">*</span></label>
              <input type="number" step="0.01" min="0.01" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} placeholder="104.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              {!sameCurrency && invoiceCurrency && (
                <p className="text-[11px] text-slate-400 mt-1">The invoiced amount in {invoiceCurrency}. {moneyNum(revenue.amount)} received prints as &quot;{baseCurrency} equivalent received&quot;.</p>
              )}
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving || !clientId} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : revenue.invoiceNumber ? "Save & download" : "Create invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Indian financial year label (April–March) for today, e.g. "2026-27".
function currentFy(): string {
  const d = new Date();
  const start = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

type PlanRow = { id: string; docNumber: number; status: string; customerName: string; entryDate: string; oldNumber: string; newNumber: string };

// Re-assign a financial year's invoice numbers in date order from a chosen
// start. Shows the full old → new mapping before anything changes; the PDFs
// are generated from the database, so every Invoice button downloads the
// renumbered version straight after.
function RenumberModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [fy, setFy] = useState(currentFy());
  const [startAt, setStartAt] = useState("1");
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ count: number; next: number } | null>(null);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(fy) || !(Number(startAt) >= 1)) { setPlan(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/finance/revenues/renumber-invoices?fy=${encodeURIComponent(fy)}&startAt=${encodeURIComponent(startAt)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not load preview"); setPlan(null); return; }
        setError("");
        setPlan((await r.json()).plan || []);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fy, startAt]);

  async function apply() {
    if (!plan || plan.length === 0) return;
    if (!confirm(`Renumber ${plan.length} invoice${plan.length === 1 ? "" : "s"} in FY ${fy} starting at ${String(Number(startAt)).padStart(3, "0")}? Previously downloaded PDFs keep their old numbers — re-download them after.`)) return;
    setApplying(true);
    setError("");
    const res = await fetch("/api/finance/revenues/renumber-invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fy, startAt: Number(startAt) }) });
    setApplying(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not renumber"); return; }
    const data = await res.json();
    setDone({ count: data.plan.length, next: data.next });
    onApplied();
  }

  const changes = plan?.filter((p) => p.oldNumber !== p.newNumber).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="text-center">
            <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl mb-3">✓</div>
            <h2 className="text-base font-semibold text-slate-900">Invoices renumbered</h2>
            <p className="text-sm text-slate-500 mt-1">{done.count} invoice{done.count === 1 ? "" : "s"} updated. The next invoice will be {String(done.next).padStart(3, "0")}. Use each row&apos;s Invoice button to download the updated PDFs.</p>
            <button onClick={onClose} className="mt-5 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Done</button>
          </div>
        ) : (
          <>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Renumber invoices</h2>
            <p className="text-xs text-slate-500 mb-4">
              Assigns numbers in the order the money was received (oldest first), one continuous sequence for the financial year regardless of month. Set the start to continue after invoices made outside the system.
            </p>
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Financial year</label>
                <input value={fy} onChange={(e) => setFy(e.target.value)} maxLength={7} placeholder="2026-27" className="w-28 rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">First number</label>
                <input type="number" min={1} value={startAt} onChange={(e) => setStartAt(e.target.value)} className="w-28 rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <span className="text-xs text-slate-500 pb-2">
                {loading ? "Loading preview…" : plan ? `${plan.length} invoice${plan.length === 1 ? "" : "s"} in FY ${fy} · ${changes} will change` : ""}
              </span>
            </div>
            {plan && plan.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2">Entry</th>
                      <th className="text-left font-semibold px-3 py-2">Received</th>
                      <th className="text-left font-semibold px-3 py-2">Client</th>
                      <th className="text-left font-semibold px-3 py-2">Current</th>
                      <th className="text-left font-semibold px-3 py-2">New</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.map((p) => (
                      <tr key={p.id} className={p.status === "voided" ? "text-slate-400" : "text-slate-700"}>
                        <td className="px-3 py-1.5 font-mono">RV-{p.docNumber}{p.status === "voided" ? " (voided)" : ""}</td>
                        <td className="px-3 py-1.5">{p.entryDate}</td>
                        <td className="px-3 py-1.5 truncate max-w-[180px]">{p.customerName}</td>
                        <td className="px-3 py-1.5 font-mono">{p.oldNumber}</td>
                        <td className={`px-3 py-1.5 font-mono ${p.oldNumber !== p.newNumber ? "font-semibold text-slate-900" : ""}`}>{p.newNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {plan && plan.length === 0 && <p className="text-sm text-slate-400 mb-4">No invoices in FY {fy}.</p>}
            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
              <button onClick={apply} disabled={applying || !plan || plan.length === 0 || changes === 0} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
                {applying ? "Renumbering…" : `Renumber ${changes} invoice${changes === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
