"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/hr/shared";

type Employee = { id: string; firstName: string; lastName: string | null; employeeCode: string };
type Doc = { id: string; type: string; title: string; reference: string | null; notes: string | null; createdAt: string };

const DOC_TYPES = [
  { value: "offer_letter", label: "Offer Letter" },
  { value: "employment_contract", label: "Employment Contract" },
  { value: "id_document", label: "ID Document" },
  { value: "certificate", label: "Certificate" },
  { value: "other", label: "Other" },
];

export default function HRDocumentsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/hr/employees?limit=200").then(async (r) => { if (r.ok) setEmployees((await r.json()).employees || []); });
  }, []);

  const loadDocs = async (empId: string) => {
    if (!empId) { setDocs([]); return; }
    const r = await fetch(`/api/hr/documents?employeeId=${empId}`);
    if (r.ok) setDocs((await r.json()).documents || []);
  };
  useEffect(() => { loadDocs(selected); }, [selected]);

  async function remove(id: string) { await fetch(`/api/hr/documents/${id}`, { method: "DELETE" }); loadDocs(selected); }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Documents" subtitle="Employee document records — offer letters, contracts, IDs, certificates. Metadata only (no file storage yet)." />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="flex gap-2 mb-4">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm">
          <option value="">Select an employee…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{[e.firstName, e.lastName].filter(Boolean).join(" ")} ({e.employeeCode})</option>)}
        </select>
        {selected && <button onClick={() => setShowForm(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md shrink-0">Add document</button>}
      </div>

      {selected && (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-[10px] font-semibold uppercase text-slate-400 w-28 shrink-0">{d.type.replace(/_/g, " ")}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">{d.title}</div>
                {d.reference && <div className="text-xs text-slate-400 truncate">{d.reference}</div>}
              </div>
              <button onClick={() => remove(d.id)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>
            </div>
          ))}
          {docs.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No documents recorded for this employee.</p>}
        </div>
      )}

      {showForm && <DocModal employeeId={selected} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); loadDocs(selected); }} onError={setError} />}
    </div>
  );
}

function DocModal({ employeeId, onClose, onSaved, onError }: { employeeId: string; onClose: () => void; onSaved: () => void; onError: (s: string) => void }) {
  const [type, setType] = useState("offer_letter");
  const [title, setTitle] = useState("");
  const [reference, setRef] = useState("");
  const [error, setError] = useState("");
  async function save() {
    setError("");
    const r = await fetch("/api/hr/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, type, title, reference: reference || null }) });
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not save"); return; }
    onError(""); onSaved();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">Add document</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Signed offer letter 2026" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Reference (placeholder)</label><input value={reference} onChange={(e) => setRef(e.target.value)} placeholder="External link / file ref" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add</button>
        </div>
      </div>
    </div>
  );
}
