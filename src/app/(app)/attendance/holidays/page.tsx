"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/attendance/shared";

type Holiday = { id: string; name: string; date: string; kind: string; recurring: boolean };

const KIND_STYLES: Record<string, string> = {
  national: "text-indigo-700 bg-indigo-50",
  company: "text-emerald-700 bg-emerald-50",
  optional: "text-slate-500 bg-slate-100",
};

export default function HolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/attendance/holidays");
    if (res.ok) setHolidays((await res.json()).holidays || []);
    // Managers are detected by whether creation is allowed — probe cheaply
    // via the leaves endpoint's canManage flag.
    const meta = await fetch("/api/attendance/leaves?limit=1");
    if (meta.ok) setCanManage(!!(await meta.json()).canManage);
  };
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    setError("");
    const res = await fetch(`/api/attendance/holidays/${id}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not delete");
    load();
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title="Holidays"
        subtitle="National, company and optional holidays. Recurring ones repeat every year automatically."
        action={canManage ? <button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add holiday</button> : undefined}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {holidays.map((h) => (
          <div key={h.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{h.name}</div>
              <div className="text-xs text-slate-400">{h.date}{h.recurring ? " · repeats yearly" : ""}</div>
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${KIND_STYLES[h.kind] || KIND_STYLES.optional}`}>{h.kind}</span>
            {canManage && <button onClick={() => remove(h.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>}
          </div>
        ))}
        {holidays.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No holidays configured yet.</p>}
      </div>

      {showForm && <HolidayModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function HolidayModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState("company");
  const [recurring, setRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/attendance/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, date, kind, recurring }),
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">Add holiday</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Independence Day" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Kind</label>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                {["national", "company", "optional"].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            Repeats every year
          </label>
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
