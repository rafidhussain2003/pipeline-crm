"use client";

import { useEffect, useState } from "react";
import { money, PageHeader } from "@/components/payroll/shared";

type Employee = {
  userId: string; name: string; email: string; role: string;
  structureId: string | null; structureName: string | null; basicCents: number | null;
  frequency: string | null; joiningDate: string | null; status: string | null;
  bankAccountRef: string | null; taxRef: string | null; notes: string | null;
};
type Structure = { id: string; name: string; frequency: string };

const STATUS_STYLES: Record<string, string> = { active: "text-emerald-700 bg-emerald-50", on_hold: "text-amber-700 bg-amber-50", terminated: "text-red-700 bg-red-50" };

export default function PayrollEmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [structures, setStructures] = useState<Structure[]>([]);
  const [edit, setEdit] = useState<Employee | null>(null);

  const load = async () => {
    const [eRes, sRes] = await Promise.all([fetch("/api/payroll/profiles"), fetch("/api/payroll/structures")]);
    if (eRes.ok) setEmployees((await eRes.json()).employees || []);
    if (sRes.ok) setStructures((await sRes.json()).structures || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Employees" subtitle="Assign each person a salary structure, payment frequency and payroll status." />

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {employees.map((e) => (
          <div key={e.userId} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate flex items-center gap-2">
                {e.name}
                {e.status && <span className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ${STATUS_STYLES[e.status] || "text-slate-500 bg-slate-100"}`}>{e.status.replace("_", " ")}</span>}
              </div>
              <div className="text-xs text-slate-400">
                {e.structureName ? `${e.structureName} · ${money(e.basicCents)} · ${e.frequency}` : "No structure assigned"}
              </div>
            </div>
            <button onClick={() => setEdit(e)} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1 shrink-0">
              {e.structureId ? "Edit" : "Set up"}
            </button>
          </div>
        ))}
        {employees.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No active employees.</p>}
      </div>

      {edit && <ProfileModal employee={edit} structures={structures} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ProfileModal({ employee, structures, onClose, onSaved }: { employee: Employee; structures: Structure[]; onClose: () => void; onSaved: () => void }) {
  const [structureId, setStructureId] = useState(employee.structureId || "");
  const [frequency, setFrequency] = useState(employee.frequency || "monthly");
  const [joiningDate, setJoiningDate] = useState(employee.joiningDate || "");
  const [status, setStatus] = useState(employee.status || "active");
  const [bankAccountRef, setBank] = useState(employee.bankAccountRef || "");
  const [taxRef, setTax] = useState(employee.taxRef || "");
  const [notes, setNotes] = useState(employee.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/payroll/profiles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: employee.userId, structureId: structureId || null, frequency, joiningDate: joiningDate || null, status, bankAccountRef: bankAccountRef || null, taxRef: taxRef || null, notes: notes || null }),
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-1">{employee.name}</h2>
        <p className="text-xs text-slate-400 mb-4">{employee.email}</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Salary structure</label>
            <select value={structureId} onChange={(e) => { setStructureId(e.target.value); const s = structures.find((x) => x.id === e.target.value); if (s) setFrequency(s.frequency); }} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">None</option>
              {structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Frequency</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                {["monthly", "weekly", "biweekly", "hourly"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                {["active", "on_hold", "terminated"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Joining date</label>
            <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Bank account (placeholder)</label>
              <input value={bankAccountRef} onChange={(e) => setBank(e.target.value)} placeholder="Account ref" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tax ref (placeholder)</label>
              <input value={taxRef} onChange={(e) => setTax(e.target.value)} placeholder="Tax ID" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
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
