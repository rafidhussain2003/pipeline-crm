"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/hr/shared";

type Settings = { employeeCodePrefix: string; nextEmployeeNumber: number; defaultEmploymentTypeId: string | null };
type Type = { id: string; name: string };

export default function HRSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [types, setTypes] = useState<Type[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = async () => {
    const r = await fetch("/api/hr/settings");
    if (r.ok) { const d = await r.json(); setS(d.settings); setTypes((d.employmentTypes || []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))); }
  };
  useEffect(() => { load(); }, []);

  async function save(patch: Partial<Settings>) {
    setMessage(null);
    const r = await fetch("/api/hr/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!r.ok) setMessage({ kind: "error", text: (await r.json().catch(() => ({}))).error || "Could not save" });
    else { setMessage({ kind: "ok", text: "Saved." }); load(); }
  }

  if (!s) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="HR Settings" subtitle="Company-wide HR configuration." />
      {message && <p className={`text-xs mb-3 ${message.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{message.text}</p>}

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Employee codes</h2>
        <p className="text-xs text-slate-400 mb-3">New employees are auto-numbered as PREFIX-000001. Next: <span className="font-mono">{s.employeeCodePrefix}-{String(s.nextEmployeeNumber).padStart(6, "0")}</span></p>
        <div className="flex gap-2 items-center">
          <input defaultValue={s.employeeCodePrefix} onBlur={(e) => e.target.value.trim().toUpperCase() !== s.employeeCodePrefix && save({ employeeCodePrefix: e.target.value.trim().toUpperCase() })} maxLength={12} className="w-32 rounded-md border border-slate-200 px-3 py-2 text-sm" />
          <span className="text-xs text-slate-400">code prefix</span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Default employment type</h2>
        <p className="text-xs text-slate-400 mb-3">Applied to new employees when none is chosen.</p>
        <select value={s.defaultEmploymentTypeId || ""} onChange={(e) => save({ defaultEmploymentTypeId: e.target.value || null })} className="w-full max-w-xs rounded-md border border-slate-200 px-3 py-2 text-sm">
          <option value="">None</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
    </div>
  );
}
