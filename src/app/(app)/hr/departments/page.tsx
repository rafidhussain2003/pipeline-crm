"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/hr/shared";

type Dept = { id: string; name: string; code: string; parentId: string | null; managerUserId: string | null; managerName: string | null; active: boolean; headcount: number };

export default function DepartmentsPage() {
  const [rows, setRows] = useState<Dept[]>([]);
  const [modal, setModal] = useState<null | { edit?: Dept }>(null);
  const [error, setError] = useState("");

  const load = async () => { const r = await fetch("/api/hr/departments"); if (r.ok) setRows((await r.json()).departments || []); };
  useEffect(() => { load(); }, []);

  async function toggle(d: Dept) { await fetch(`/api/hr/departments/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !d.active }) }); load(); }
  async function remove(d: Dept) { setError(""); const r = await fetch(`/api/hr/departments/${d.id}`, { method: "DELETE" }); if (!r.ok) setError((await r.json().catch(() => ({}))).error || "Could not delete"); load(); }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Departments" subtitle="Company departments — hierarchy-ready, with an optional department head." action={<button onClick={() => setModal({})} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add department</button>} />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((d) => (
          <div key={d.id} className={`flex items-center gap-3 px-4 py-3 ${d.active ? "" : "opacity-50"}`}>
            <span className="text-xs font-mono text-slate-400 w-20 shrink-0 truncate">{d.code}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{d.name}{d.parentId ? <span className="text-slate-400"> · sub-dept</span> : ""}</div>
              <div className="text-xs text-slate-400">{d.headcount} employee(s){d.managerName ? ` · head: ${d.managerName}` : ""}</div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => setModal({ edit: d })} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">Edit</button>
              <button onClick={() => toggle(d)} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">{d.active ? "Deactivate" : "Activate"}</button>
              {d.headcount === 0 && <button onClick={() => remove(d)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No departments yet.</p>}
      </div>
      {modal && <DeptModal edit={modal.edit} departments={rows} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} onError={setError} />}
    </div>
  );
}

function DeptModal({ edit, departments, onClose, onSaved, onError }: { edit?: Dept; departments: Dept[]; onClose: () => void; onSaved: () => void; onError: (s: string) => void }) {
  const [name, setName] = useState(edit?.name || "");
  const [code, setCode] = useState(edit?.code || "");
  const [parentId, setParent] = useState(edit?.parentId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    const body = edit ? { name, parentId: parentId || null } : { name, code, parentId: parentId || null };
    const res = edit ? await fetch(`/api/hr/departments/${edit.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) : await fetch("/api/hr/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not save"); return; }
    onError(""); onSaved();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">{edit ? "Edit department" : "Add department"}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Name</label><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
            {!edit && <div><label className="block text-xs font-semibold text-slate-600 mb-1">Code</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ENG" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Parent department (optional)</label>
            <select value={parentId} onChange={(e) => setParent(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">None (top level)</option>
              {departments.filter((d) => d.id !== edit?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
