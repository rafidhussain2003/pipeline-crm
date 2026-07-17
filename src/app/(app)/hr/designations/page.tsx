"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/hr/shared";

type Desig = { id: string; title: string; code: string; departmentId: string | null; departmentName: string | null; level: number; active: boolean };
type Dept = { id: string; name: string };

export default function DesignationsPage() {
  const [rows, setRows] = useState<Desig[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [modal, setModal] = useState<null | { edit?: Desig }>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const [d, dep] = await Promise.all([fetch("/api/hr/designations"), fetch("/api/hr/departments")]);
    if (d.ok) setRows((await d.json()).designations || []);
    if (dep.ok) setDepts(((await dep.json()).departments || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
  };
  useEffect(() => { load(); }, []);

  async function remove(d: Desig) { setError(""); const r = await fetch(`/api/hr/designations/${d.id}`, { method: "DELETE" }); if (!r.ok) setError((await r.json().catch(() => ({}))).error || "Could not delete"); load(); }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Designations" subtitle="Job titles, optionally scoped to a department, with a seniority level (1 = most senior)." action={<button onClick={() => setModal({})} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add designation</button>} />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((d) => (
          <div key={d.id} className={`flex items-center gap-3 px-4 py-3 ${d.active ? "" : "opacity-50"}`}>
            <span className="text-[10px] font-semibold text-slate-400 w-8 shrink-0">L{d.level}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{d.title}</div>
              <div className="text-xs text-slate-400">{d.code}{d.departmentName ? ` · ${d.departmentName}` : ""}</div>
            </div>
            <button onClick={() => setModal({ edit: d })} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">Edit</button>
            <button onClick={() => remove(d)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No designations yet.</p>}
      </div>
      {modal && <DesigModal edit={modal.edit} depts={depts} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} onError={setError} />}
    </div>
  );
}

function DesigModal({ edit, depts, onClose, onSaved, onError }: { edit?: Desig; depts: Dept[]; onClose: () => void; onSaved: () => void; onError: (s: string) => void }) {
  const [title, setTitle] = useState(edit?.title || "");
  const [code, setCode] = useState(edit?.code || "");
  const [departmentId, setDept] = useState(edit?.departmentId || "");
  const [level, setLevel] = useState(String(edit?.level ?? 5));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    const body = edit ? { title, departmentId: departmentId || null, level: Number(level) } : { title, code, departmentId: departmentId || null, level: Number(level) };
    const res = edit ? await fetch(`/api/hr/designations/${edit.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) : await fetch("/api/hr/designations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not save"); return; }
    onError(""); onSaved();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">{edit ? "Edit designation" : "Add designation"}</h2>
        <div className="space-y-3">
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Engineer" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            {!edit && <div><label className="block text-xs font-semibold text-slate-600 mb-1">Code</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SR_ENG" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>}
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Level (1-20)</label><input type="number" min="1" max="20" value={level} onChange={(e) => setLevel(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Department (optional)</label>
            <select value={departmentId} onChange={(e) => setDept(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Any</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
