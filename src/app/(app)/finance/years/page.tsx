"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/finance/shared";

type Year = { id: string; label: string; startDate: string; endDate: string; status: "open" | "closed"; isCurrent: boolean; isFuture: boolean };

export default function FinancialYearPage() {
  const [years, setYears] = useState<Year[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/finance/years");
    if (res.ok) setYears((await res.json()).years || []);
  };
  useEffect(() => { load(); }, []);

  async function setStatus(id: string, status: "open" | "closed") {
    setError("");
    const res = await fetch(`/api/finance/years/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not update");
    load();
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title="Financial Year"
        subtitle="Define your accounting periods. Closing a year locks every date inside it — nothing can post or void there until it is reopened."
        action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add year</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {years.map((y) => (
          <div key={y.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                {y.label}
                {y.isCurrent && <span className="text-[10px] font-semibold uppercase text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5">Current</span>}
                {y.isFuture && <span className="text-[10px] font-semibold uppercase text-sky-600 bg-sky-50 rounded-full px-2 py-0.5">Future</span>}
              </div>
              <div className="text-xs text-slate-400">{y.startDate} → {y.endDate}</div>
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${y.status === "open" ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"}`}>
              {y.status}
            </span>
            {y.status === "open" ? (
              <button onClick={() => setStatus(y.id, "closed")} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Close & lock</button>
            ) : (
              <button onClick={() => setStatus(y.id, "open")} className="text-[11px] font-medium text-slate-600 bg-slate-100 rounded px-2 py-1">Reopen</button>
            )}
          </div>
        ))}
        {years.length === 0 && (
          <p className="text-sm text-slate-400 px-4 py-8 text-center">
            No financial years defined yet. Until you add one, entries can be posted on any date.
          </p>
        )}
      </div>

      {showForm && <YearModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function YearModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const thisYear = new Date().getFullYear();
  const [label, setLabel] = useState(`FY ${thisYear}`);
  const [startDate, setStartDate] = useState(`${thisYear}-01-01`);
  const [endDate, setEndDate] = useState(`${thisYear}-12-31`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/finance/years", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, startDate, endDate }),
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
        <h2 className="text-base font-semibold text-slate-900 mb-4">Add financial year</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Starts</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ends</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
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
