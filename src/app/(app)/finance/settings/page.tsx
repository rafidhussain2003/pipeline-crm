"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/finance/shared";

type Settings = {
  defaultCurrency: string; nextJournalNumber: number; nextRevenueNumber: number; nextExpenseNumber: number; openingBalancesLockedAt: string | null;
  invoiceLegalName: string | null; invoiceAddress: string | null; invoiceGstin: string | null; invoiceLutNote: string | null;
  invoiceSignatoryName: string | null; invoiceSignatoryTitle: string | null; invoiceNumberPrefix: string; invoiceNumberFy: string | null; nextInvoiceNumber: number;
};

// Indian financial year label (April–March) for today, e.g. "2026-27".
function currentFy(): string {
  const d = new Date();
  const start = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

type InvoiceForm = Record<"invoiceLegalName" | "invoiceAddress" | "invoiceGstin" | "invoiceLutNote" | "invoiceSignatoryName" | "invoiceSignatoryTitle" | "invoiceNumberPrefix" | "invoiceNumberFy" | "nextInvoiceNumber", string>;

export default function FinanceSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceForm | null>(null);
  const [savingInvoice, setSavingInvoice] = useState(false);

  const load = async () => {
    const res = await fetch("/api/finance/settings");
    if (res.ok) {
      const s = (await res.json()).settings as Settings;
      setSettings(s);
      setCurrency(s.defaultCurrency);
      setInvoice({
        invoiceLegalName: s.invoiceLegalName ?? "",
        invoiceAddress: s.invoiceAddress ?? "",
        invoiceGstin: s.invoiceGstin ?? "",
        invoiceLutNote: s.invoiceLutNote ?? "",
        invoiceSignatoryName: s.invoiceSignatoryName ?? "",
        invoiceSignatoryTitle: s.invoiceSignatoryTitle ?? "",
        invoiceNumberPrefix: s.invoiceNumberPrefix ?? "INV",
        invoiceNumberFy: s.invoiceNumberFy ?? currentFy(),
        nextInvoiceNumber: String(s.nextInvoiceNumber ?? 1),
      });
    }
  };
  useEffect(() => { load(); }, []);

  async function saveCurrency() {
    setMessage(null);
    const res = await fetch("/api/finance/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultCurrency: currency }) });
    if (!res.ok) setMessage({ kind: "error", text: (await res.json().catch(() => ({}))).error || "Could not save" });
    else setMessage({ kind: "ok", text: "Saved." });
    load();
  }

  async function saveInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setMessage(null);
    setSavingInvoice(true);
    const res = await fetch("/api/finance/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...invoice, nextInvoiceNumber: Number(invoice.nextInvoiceNumber) }),
    });
    setSavingInvoice(false);
    if (!res.ok) setMessage({ kind: "error", text: (await res.json().catch(() => ({}))).error || "Could not save" });
    else setMessage({ kind: "ok", text: "Invoice details saved." });
    load();
  }

  async function confirmOpening() {
    setMessage(null);
    setConfirming(false);
    const res = await fetch("/api/finance/opening-balances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm" }) });
    if (!res.ok) setMessage({ kind: "error", text: (await res.json().catch(() => ({}))).error || "Could not lock" });
    else setMessage({ kind: "ok", text: "Opening balances are now locked." });
    load();
  }

  if (!settings) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Finance Settings" subtitle="Module-wide configuration for this company's books." />
      {message && <p className={`text-xs mb-3 ${message.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{message.text}</p>}

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Opening balances</h2>
        {settings.openingBalancesLockedAt ? (
          <p className="text-xs text-slate-500">
            Locked on {new Date(settings.openingBalancesLockedAt).toLocaleString()}. Corrections now require adjusting journal entries — exactly like any posted history.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">
              Set opening balances from the Cash, Bank, or Chart of Accounts pages. When your starting figures are right, confirm to lock them permanently.
            </p>
            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-medium">This cannot be undone.</span>
                <button onClick={confirmOpening} className="bg-red-600 text-white text-xs font-medium px-3 py-1.5 rounded-md">Lock opening balances</button>
                <button onClick={() => setConfirming(false)} className="text-xs font-medium text-slate-500 px-2 py-1.5">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirming(true)} className="bg-slate-900 text-white text-xs font-medium px-3 py-1.5 rounded-md">Confirm & lock opening balances</button>
            )}
          </>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Currency</h2>
        <div className="flex gap-2 items-center">
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="w-24 rounded-md border border-slate-200 px-3 py-2 text-sm" />
          <button onClick={saveCurrency} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Save</button>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Base currency of the books. Invoices print the amount received in it as the &quot;{currency || "INR"} equivalent received&quot; row — set INR for Indian books.</p>
      </div>

      {invoice && (
        <form onSubmit={saveInvoice} className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Invoice details</h2>
          <p className="text-xs text-slate-500 mb-4">
            Printed at the top of every tax invoice generated when revenue is posted against a client (export under LUT, 0% IGST). Enter them once.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Legal name <span className="text-red-500">*</span></label>
              <input value={invoice.invoiceLegalName} onChange={(e) => setInvoice({ ...invoice, invoiceLegalName: e.target.value })} required placeholder="BRIVENT SOLUTIONS (OPC) PRIVATE LIMITED" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Registered address <span className="text-red-500">*</span></label>
              <textarea value={invoice.invoiceAddress} onChange={(e) => setInvoice({ ...invoice, invoiceAddress: e.target.value })} required rows={2} placeholder={"Office No. 1004, Technocity, Opp. Millennium Business Park,\nPlot X 5/3, Mahape, Navi Mumbai, Maharashtra – 400710"} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              <p className="text-[11px] text-slate-400 mt-1">One line per row, printed exactly as typed.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">GSTIN</label>
              <input value={invoice.invoiceGstin} onChange={(e) => setInvoice({ ...invoice, invoiceGstin: e.target.value.toUpperCase() })} placeholder="27AAOCB5441K1ZB" maxLength={32} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Next invoice number</label>
              <div className="flex items-center gap-1">
                <input value={invoice.invoiceNumberPrefix} onChange={(e) => setInvoice({ ...invoice, invoiceNumberPrefix: e.target.value.toUpperCase() })} maxLength={16} aria-label="Prefix" className="w-16 rounded-md border border-slate-200 px-2 py-2 text-sm" />
                <span className="text-slate-400">/</span>
                <input value={invoice.invoiceNumberFy} onChange={(e) => setInvoice({ ...invoice, invoiceNumberFy: e.target.value })} maxLength={7} aria-label="Financial year" placeholder="2026-27" className="w-20 rounded-md border border-slate-200 px-2 py-2 text-sm" />
                <span className="text-slate-400">/</span>
                <input type="number" min={1} value={invoice.nextInvoiceNumber} onChange={(e) => setInvoice({ ...invoice, nextInvoiceNumber: e.target.value })} aria-label="Next number" className="w-20 rounded-md border border-slate-200 px-2 py-2 text-sm" />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Restarts at 001 each financial year automatically.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">LUT note</label>
              <input value={invoice.invoiceLutNote} onChange={(e) => setInvoice({ ...invoice, invoiceLutNote: e.target.value })} placeholder="LUT for FY 2026-27 filed on 15 April 2026. LUT ARN/reference as per GST portal record." className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              <p className="text-[11px] text-slate-400 mt-1">Printed under &quot;Supply meant for export under Letter of Undertaking (LUT) without payment of IGST.&quot; Update it each year when the new LUT is filed.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Authorized signatory</label>
              <input value={invoice.invoiceSignatoryName} onChange={(e) => setInvoice({ ...invoice, invoiceSignatoryName: e.target.value })} placeholder="Rafid Hussain" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Signatory designation</label>
              <input value={invoice.invoiceSignatoryTitle} onChange={(e) => setInvoice({ ...invoice, invoiceSignatoryTitle: e.target.value })} placeholder="Director" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button type="submit" disabled={savingInvoice} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{savingInvoice ? "Saving…" : "Save invoice details"}</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Document numbering</h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            ["Next journal", `JE-${settings.nextJournalNumber}`],
            ["Next revenue", `RV-${settings.nextRevenueNumber}`],
            ["Next expense", `EX-${settings.nextExpenseNumber}`],
          ].map(([label, value]) => (
            <div key={label} className="bg-slate-50 rounded-md p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
              <div className="text-sm font-semibold text-slate-800 mt-1">{value}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Numbers are sequential per company and assigned automatically at posting.</p>
      </div>
    </div>
  );
}
