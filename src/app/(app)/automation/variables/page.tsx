"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/automation/shared";

type Variable = { id: string; key: string; valueType: string; value: unknown; description: string | null };
type Namespace = { key: string; label: string; source: string; description: string };

export default function VariablesPage() {
  const [variables, setVariables] = useState<Variable[]>([]);
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [form, setForm] = useState<{ key: string; valueType: string; value: string; description: string } | null>(null);
  const [error, setError] = useState("");

  const load = async () => { const r = await fetch("/api/automation/variables"); if (r.ok) { const d = await r.json(); setVariables(d.variables || []); setNamespaces(d.namespaces || []); } };
  useEffect(() => { load(); }, []);

  async function save() {
    if (!form) return;
    setError("");
    const r = await fetch("/api/automation/variables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not save"); return; }
    setForm(null); load();
  }
  async function remove(id: string) { await fetch(`/api/automation/variables/${id}`, { method: "DELETE" }); load(); }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Variables" subtitle="Reusable values available to conditions and actions via {{ path }}." action={<button onClick={() => setForm({ key: "", valueType: "string", value: "", description: "" })} className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md">New global variable</button>} />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <h2 className="text-sm font-semibold text-slate-700 mb-2">Global variables</h2>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-6">
        {variables.map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-4 py-3">
            <code className="text-xs font-mono text-indigo-700 bg-indigo-50 rounded px-1.5 py-0.5">global.{v.key}</code>
            <div className="flex-1 min-w-0 text-sm text-slate-700 truncate">{typeof v.value === "object" ? JSON.stringify(v.value) : String(v.value)}</div>
            <span className="text-[10px] uppercase text-slate-400">{v.valueType}</span>
            <button onClick={() => remove(v.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>
          </div>
        ))}
        {variables.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No global variables yet.</p>}
      </div>

      <h2 className="text-sm font-semibold text-slate-700 mb-2">Available namespaces</h2>
      <div className="grid sm:grid-cols-2 gap-2">
        {namespaces.map((n) => (
          <div key={n.key} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-slate-700">{n.key}.*</code>
              <span className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 ${n.source === "user" ? "text-indigo-600 bg-indigo-50" : "text-slate-400 bg-slate-100"}`}>{n.source}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{n.description}</p>
          </div>
        ))}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 mb-4">New global variable</h2>
            <div className="space-y-3">
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Key</label><input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="companyName" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
                <select value={form.valueType} onChange={(e) => setForm({ ...form, valueType: e.target.value })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                  {["string", "number", "boolean", "json"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Value</label><input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setForm(null)} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
              <button onClick={save} className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
