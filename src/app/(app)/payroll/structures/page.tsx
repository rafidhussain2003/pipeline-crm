"use client";

import { useEffect, useState } from "react";
import { money, PageHeader } from "@/components/payroll/shared";

type Component = { key?: string; label: string; type: string; amountCents: number };
type Structure = { id: string; name: string; frequency: string; basicCents: number; components: Component[]; version: number };

const COMPONENT_TYPES = [
  { value: "allowance", label: "Allowance" },
  { value: "hra", label: "HRA (placeholder)" },
  { value: "fixed_incentive", label: "Fixed incentive" },
  { value: "employer_contribution", label: "Employer contribution (placeholder)" },
  { value: "deduction", label: "Deduction" },
  { value: "custom", label: "Custom earning" },
];

export default function SalaryStructuresPage() {
  const [structures, setStructures] = useState<Structure[]>([]);
  const [modal, setModal] = useState<null | { edit?: Structure }>(null);
  const [history, setHistory] = useState<Structure[] | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/payroll/structures");
    if (res.ok) setStructures((await res.json()).structures || []);
  };
  useEffect(() => { load(); }, []);

  async function showHistory(id: string) {
    const res = await fetch(`/api/payroll/structures/${id}`);
    if (res.ok) setHistory((await res.json()).versions || []);
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Salary Structures"
        subtitle="Versioned pay templates. Editing a structure creates a new version; assigned employees move to it, and past payroll runs keep their snapshot."
        action={<button onClick={() => setModal({})} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">New structure</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="space-y-3">
        {structures.map((s) => {
          const earnings = s.components.filter((c) => c.type !== "deduction" && c.type !== "employer_contribution");
          const deductions = s.components.filter((c) => c.type === "deduction");
          const gross = s.basicCents + earnings.reduce((a, c) => a + c.amountCents, 0);
          return (
            <div key={s.id} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    {s.name}
                    <span className="text-[10px] font-semibold uppercase text-slate-400 capitalize">{s.frequency}</span>
                    <span className="text-[10px] font-medium text-slate-400">v{s.version}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Basic {money(s.basicCents)} · Gross ~{money(gross)}{deductions.length > 0 ? ` · ${deductions.length} deduction(s)` : ""}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => showHistory(s.id)} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">History</button>
                  <button onClick={() => setModal({ edit: s })} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">Edit</button>
                </div>
              </div>
            </div>
          );
        })}
        {structures.length === 0 && <p className="text-sm text-slate-400">No salary structures yet.</p>}
      </div>

      {modal && <StructureModal edit={modal.edit} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} onError={setError} />}
      {history && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setHistory(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 mb-3">Version history</h2>
            <div className="space-y-2">
              {history.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                  <span className="text-slate-700">v{v.version} — {v.name}</span>
                  <span className="text-slate-500">{money(v.basicCents)} basic</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setHistory(null)} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StructureModal({ edit, onClose, onSaved, onError }: { edit?: Structure; onClose: () => void; onSaved: () => void; onError: (s: string) => void }) {
  const [name, setName] = useState(edit?.name || "");
  const [frequency, setFrequency] = useState(edit?.frequency || "monthly");
  const [basic, setBasic] = useState(edit ? (edit.basicCents / 100).toString() : "");
  const [components, setComponents] = useState<{ label: string; type: string; amount: string }[]>(
    edit ? edit.components.map((c) => ({ label: c.label, type: c.type, amount: (c.amountCents / 100).toString() })) : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const payload = {
      name,
      frequency,
      basic: Number(basic || 0),
      components: components.filter((c) => c.label.trim() && Number(c.amount) > 0).map((c) => ({ label: c.label.trim(), type: c.type, amount: Number(c.amount) })),
    };
    const res = edit
      ? await fetch(`/api/payroll/structures/${edit.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/payroll/structures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not save");
      return;
    }
    onError("");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">{edit ? `Edit ${edit.name} (new version)` : "New salary structure"}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Senior Engineer" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Frequency</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                {["monthly", "weekly", "biweekly", "hourly"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Basic salary</label>
            <input type="number" step="0.01" min="0" value={basic} onChange={(e) => setBasic(e.target.value)} placeholder="0.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-600">Components</label>
              <button onClick={() => setComponents((cs) => [...cs, { label: "", type: "allowance", amount: "" }])} className="text-xs font-medium text-blue-600">+ Add</button>
            </div>
            <div className="space-y-2">
              {components.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_140px_110px_28px] gap-2 items-center">
                  <input value={c.label} onChange={(e) => setComponents((cs) => cs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" className="rounded-md border border-slate-200 px-2 py-2 text-sm" />
                  <select value={c.type} onChange={(e) => setComponents((cs) => cs.map((x, j) => j === i ? { ...x, type: e.target.value } : x))} className="rounded-md border border-slate-200 px-2 py-2 text-sm">
                    {COMPONENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input type="number" step="0.01" min="0" value={c.amount} onChange={(e) => setComponents((cs) => cs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder="0.00" className="rounded-md border border-slate-200 px-2 py-2 text-sm text-right" />
                  <button onClick={() => setComponents((cs) => cs.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500 text-lg leading-none">×</button>
                </div>
              ))}
              {components.length === 0 && <p className="text-[11px] text-slate-400">Basic salary only. Add allowances, incentives or deductions above.</p>}
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : edit ? "Save new version" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
