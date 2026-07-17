"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/hr/shared";

type Type = { id: string; name: string; code: string; isSystem: boolean };

export default function EmploymentTypesPage() {
  const [rows, setRows] = useState<Type[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const load = async () => { const r = await fetch("/api/hr/employment-types"); if (r.ok) setRows((await r.json()).types || []); };
  useEffect(() => { load(); }, []);

  async function add() {
    setError("");
    const r = await fetch("/api/hr/employment-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, code }) });
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not add"); return; }
    setShowForm(false); setName(""); setCode(""); load();
  }
  async function remove(id: string) { setError(""); const r = await fetch(`/api/hr/employment-types/${id}`, { method: "DELETE" }); if (!r.ok) setError((await r.json().catch(() => ({}))).error || "Could not delete"); load(); }

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Employment Types" subtitle="Permanent, Contract, Intern, Part-time and Temporary come standard; add your own custom types." action={<button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add type</button>} />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900">{t.name}{t.isSystem && <span className="ml-1.5 text-[10px] font-semibold uppercase text-slate-400">Standard</span>}</div>
              <div className="text-xs text-slate-400 font-mono">{t.code}</div>
            </div>
            {!t.isSystem && <button onClick={() => remove(t.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>}
          </div>
        ))}
      </div>
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 mb-4">Add employment type</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Consultant" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Code</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CONSULTANT" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
            </div>
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
              <button onClick={add} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
