"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/finance/shared";

type Settings = { defaultCurrency: string; nextJournalNumber: number; nextRevenueNumber: number; nextExpenseNumber: number; openingBalancesLockedAt: string | null };

export default function FinanceSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    const res = await fetch("/api/finance/settings");
    if (res.ok) {
      const s = (await res.json()).settings as Settings;
      setSettings(s);
      setCurrency(s.defaultCurrency);
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
        <p className="text-[11px] text-slate-400 mt-2">Display currency. Multi-currency accounting is a future module.</p>
      </div>

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
