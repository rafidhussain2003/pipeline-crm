"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPLOYMENT_STATUSES, Field, PageHeader, StatusBadge } from "@/components/hr/shared";

type Employee = { id: string; userId: string; employeeCode: string; firstName: string; lastName: string | null; email: string; employmentStatus: string; departmentName: string | null; designationTitle: string | null; managerUserId: string | null };
type Detail = Employee & { phone: string | null; loginName: string; preferredName: string | null; dateOfBirth: string | null; gender: string | null; joiningDate: string | null; confirmationDate: string | null; employmentTypeName: string | null; managerName: string | null; workLocation: string | null; notes: string | null };
type Ref = { id: string; name?: string; title?: string };
type UserOpt = { id: string; name: string; email: string };

export default function HREmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Ref[]>([]);
  const [designations, setDesignations] = useState<Ref[]>([]);
  const [types, setTypes] = useState<Ref[]>([]);
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("");
  const [modal, setModal] = useState<null | { create?: boolean; editId?: string }>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  const loadRefs = useCallback(async () => {
    const [d, g, t] = await Promise.all([fetch("/api/hr/departments"), fetch("/api/hr/designations"), fetch("/api/hr/employment-types")]);
    if (d.ok) setDepartments(((await d.json()).departments || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
    if (g.ok) setDesignations(((await g.json()).designations || []).map((x: { id: string; title: string }) => ({ id: x.id, title: x.title })));
    if (t.ok) setTypes(((await t.json()).types || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
  }, []);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("search", search.trim());
    if (statusF) p.set("status", statusF);
    const res = await fetch(`/api/hr/employees?${p}`);
    if (res.ok) setEmployees((await res.json()).employees || []);
  }, [search, statusF]);

  useEffect(() => { loadRefs(); }, [loadRefs]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  async function open(id: string) {
    const res = await fetch(`/api/hr/employees/${id}`);
    if (res.ok) setDetail((await res.json()).employee);
  }

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Employees" subtitle="The master employee directory — one authoritative profile per person." action={<button onClick={() => setModal({ create: true })} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add employee</button>} />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="flex flex-wrap gap-2 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code or email…" className="flex-1 min-w-[220px] rounded-md border border-slate-200 px-3 py-2 text-sm" />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 capitalize">
          <option value="">All statuses</option>
          {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {employees.map((e) => (
          <button key={e.id} onClick={() => open(e.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <span className="text-xs font-mono text-slate-400 w-24 shrink-0 truncate">{e.employeeCode}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{[e.firstName, e.lastName].filter(Boolean).join(" ")}</div>
              <div className="text-xs text-slate-400 truncate">{e.email}{e.designationTitle ? ` · ${e.designationTitle}` : ""}{e.departmentName ? ` · ${e.departmentName}` : ""}</div>
            </div>
            <StatusBadge status={e.employmentStatus} />
          </button>
        ))}
        {employees.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No employees{search || statusF ? " match" : " yet"}.</p>}
      </div>

      {modal && <EmployeeModal editId={modal.editId} departments={departments} designations={designations} types={types} employees={employees} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} onError={setError} />}
      {detail && (
        <DetailModal detail={detail} onClose={() => setDetail(null)} onEdit={() => { setModal({ editId: detail.id }); setDetail(null); }} onDeleted={() => { setDetail(null); load(); }} onError={setError} />
      )}
    </div>
  );
}

function DetailModal({ detail, onClose, onEdit, onDeleted, onError }: { detail: Detail; onClose: () => void; onEdit: () => void; onDeleted: () => void; onError: (s: string) => void }) {
  async function del() {
    const res = await fetch(`/api/hr/employees/${detail.id}`, { method: "DELETE" });
    if (!res.ok) { onError((await res.json().catch(() => ({}))).error || "Could not delete"); onClose(); return; }
    onError("");
    onDeleted();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{[detail.firstName, detail.lastName].filter(Boolean).join(" ")}</h2>
            <p className="text-xs text-slate-400">{detail.employeeCode} · {detail.email}</p>
          </div>
          <StatusBadge status={detail.employmentStatus} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preferred name" value={detail.preferredName} />
          <Field label="Phone" value={detail.phone} />
          <Field label="Department" value={detail.departmentName} />
          <Field label="Designation" value={detail.designationTitle} />
          <Field label="Employment type" value={detail.employmentTypeName} />
          <Field label="Reports to" value={detail.managerName} />
          <Field label="Joining date" value={detail.joiningDate} />
          <Field label="Date of birth" value={detail.dateOfBirth} />
          <Field label="Work location" value={detail.workLocation} />
          <Field label="Gender" value={detail.gender} />
        </div>
        {detail.notes && <div className="mt-3"><Field label="Notes" value={detail.notes} /></div>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={del} className="text-sm font-medium text-red-600 px-3 py-2 rounded-md hover:bg-red-50">Delete</button>
          <button onClick={onEdit} className="text-sm font-medium text-slate-600 bg-slate-100 px-4 py-2 rounded-md">Edit</button>
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}

function EmployeeModal({ editId, departments, designations, types, employees, onClose, onSaved, onError }: { editId?: string; departments: Ref[]; designations: Ref[]; types: Ref[]; employees: Employee[]; onClose: () => void; onSaved: () => void; onError: (s: string) => void }) {
  const [unprofiled, setUnprofiled] = useState<UserOpt[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ userId: "", firstName: "", lastName: "", employmentStatus: "active", departmentId: "", designationId: "", employmentTypeId: "", managerUserId: "", joiningDate: "", dateOfBirth: "", workLocation: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editId) {
      fetch(`/api/hr/employees/${editId}`).then(async (r) => {
        if (!r.ok) return;
        const e = (await r.json()).employee;
        setForm({ userId: e.userId, firstName: e.firstName || "", lastName: e.lastName || "", employmentStatus: e.employmentStatus, departmentId: e.departmentId || "", designationId: e.designationId || "", employmentTypeId: e.employmentTypeId || "", managerUserId: e.managerUserId || "", joiningDate: e.joiningDate || "", dateOfBirth: e.dateOfBirth || "", workLocation: e.workLocation || "", notes: e.notes || "" });
      });
    } else {
      fetch("/api/hr/employees?unprofiled=1").then(async (r) => { if (r.ok) setUnprofiled((await r.json()).users || []); });
    }
  }, [editId]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setError("");
    const payload: Record<string, unknown> = { ...form };
    for (const k of Object.keys(payload)) if (payload[k] === "") payload[k] = null;
    const res = editId
      ? await fetch(`/api/hr/employees/${editId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/hr/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, userId: form.userId }) });
    setSaving(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || "Could not save"); return; }
    onError("");
    onSaved();
  }

  const managerOptions = employees.filter((e) => e.userId !== form.userId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">{editId ? "Edit employee" : "Add employee"}</h2>
        <div className="space-y-3">
          {!editId && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">User (must be a company member without a profile)</label>
              <select value={form.userId} onChange={(e) => set("userId", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="" disabled>Select a user…</option>
                {unprofiled.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
              </select>
              {unprofiled.length === 0 && <p className="text-[11px] text-slate-400 mt-1">Every company member already has an HR profile.</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">First name</label>
              <input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Last name</label>
              <input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Department" v={form.departmentId} onC={(v) => set("departmentId", v)} opts={departments.map((d) => ({ id: d.id, label: d.name! }))} />
            <Sel label="Designation" v={form.designationId} onC={(v) => set("designationId", v)} opts={designations.map((d) => ({ id: d.id, label: d.title! }))} />
            <Sel label="Employment type" v={form.employmentTypeId} onC={(v) => set("employmentTypeId", v)} opts={types.map((d) => ({ id: d.id, label: d.name! }))} />
            <Sel label="Reports to" v={form.managerUserId} onC={(v) => set("managerUserId", v)} opts={managerOptions.map((m) => ({ id: m.userId, label: [m.firstName, m.lastName].filter(Boolean).join(" ") }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
              <select value={form.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
                {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Joining date</label>
              <input type="date" value={form.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date of birth</label>
              <input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Work location (placeholder)</label>
            <input value={form.workLocation} onChange={(e) => set("workLocation", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving || (!editId && !form.userId)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Sel({ label, v, onC, opts }: { label: string; v: string; onC: (v: string) => void; opts: { id: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <select value={v} onChange={(e) => onC(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
        <option value="">—</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}
