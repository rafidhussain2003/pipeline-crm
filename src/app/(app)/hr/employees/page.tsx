"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EMPLOYMENT_STATUSES, Field, PageHeader, StatusBadge } from "@/components/hr/shared";

type Employee = { id: string; userId: string; employeeCode: string; firstName: string; lastName: string | null; email: string; employmentStatus: string; departmentName: string | null; designationTitle: string | null; managerUserId: string | null };
type SalaryComp = { label: string; amount: number; kind: "earning" | "deduction" };
type SalaryStructure = { currency?: string; components: SalaryComp[] };
type Doc = { id: string; type: string; title: string; reference: string | null; fileName: string | null; mimeType: string | null; fileSize: number | null; notes: string | null; createdAt: string };
type Detail = Employee & { phone: string | null; loginName: string; preferredName: string | null; dateOfBirth: string | null; gender: string | null; joiningDate: string | null; confirmationDate: string | null; employmentTypeName: string | null; managerName: string | null; workLocation: string | null; monthlySalary: string | null; salaryStructure: SalaryStructure | null; notes: string | null };

const DOC_TYPES: { value: string; label: string }[] = [
  { value: "offer_letter", label: "Offer letter" },
  { value: "employment_contract", label: "Agreement / contract" },
  { value: "id_document", label: "ID document" },
  { value: "certificate", label: "Certificate" },
  { value: "other", label: "Other" },
];
type AuditEntry = { id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; createdAt: string; actorName: string | null };
type ModuleDef = { key: string; label: string; description: string };
type Ref = { id: string; name?: string; title?: string };

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
          <Field label="Monthly salary" value={detail.monthlySalary ? Number(detail.monthlySalary).toLocaleString("en-US", { minimumFractionDigits: 2 }) : null} />
        </div>
        {detail.notes && <div className="mt-3"><Field label="Notes" value={detail.notes} /></div>}

        <SalaryStructureCard employeeId={detail.id} initial={detail.salaryStructure} onError={onError} />
        <DocumentsCard employeeId={detail.id} onError={onError} />
        <ModuleAccessCard userId={detail.userId} />
        <AuditHistoryCard employeeId={detail.id} />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={del} className="text-sm font-medium text-red-600 px-3 py-2 rounded-md hover:bg-red-50">Delete</button>
          <button onClick={onEdit} className="text-sm font-medium text-slate-600 bg-slate-100 px-4 py-2 rounded-md">Edit</button>
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}

// Salary structure on the profile: itemised earnings/deductions with computed
// gross/net, edited inline and saved to the employee record.
function SalaryStructureCard({ employeeId, initial, onError }: { employeeId: string; initial: SalaryStructure | null; onError: (s: string) => void }) {
  const [comps, setComps] = useState<SalaryComp[]>(initial?.components ?? []);
  const [currency, setCurrency] = useState(initial?.currency || "INR");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const earnings = comps.filter((c) => c.kind === "earning").reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const deductions = comps.filter((c) => c.kind === "deduction").reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const fmt = (n: number) => `${currency} ${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  async function save() {
    setSaving(true);
    const clean = comps.map((c) => ({ label: c.label.trim(), amount: Number(c.amount) || 0, kind: c.kind })).filter((c) => c.label);
    const res = await fetch(`/api/hr/employees/${employeeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ salaryStructure: { currency: currency.trim() || "INR", components: clean } }) });
    setSaving(false);
    if (!res.ok) { onError((await res.json().catch(() => ({}))).error || "Could not save salary structure"); return; }
    onError("");
    setComps(clean);
    setEditing(false);
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Salary structure</h3>
        {!editing && <button onClick={() => setEditing(true)} className="text-xs font-medium text-blue-600">{comps.length ? "Edit" : "Add structure"}</button>}
      </div>
      {!editing ? (
        comps.length === 0 ? (
          <p className="text-xs text-slate-400">No salary structure set.</p>
        ) : (
          <div className="text-sm">
            <div className="divide-y divide-slate-50">
              {comps.map((c, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-slate-700">{c.label}{c.kind === "deduction" && <span className="text-[10px] text-red-500"> (deduction)</span>}</span>
                  <span className={`tabular-nums ${c.kind === "deduction" ? "text-red-600" : "text-slate-800"}`}>{c.kind === "deduction" ? "-" : ""}{fmt(Number(c.amount) || 0)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-x-4 text-xs">
              <span className="text-slate-500">Gross {fmt(earnings)} · Deductions {fmt(deductions)}</span>
              <span className="font-semibold text-slate-900">Net {fmt(earnings - deductions)}</span>
            </div>
          </div>
        )
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Currency</label>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-20 rounded border border-slate-200 px-2 py-1 text-xs" />
          </div>
          {comps.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={c.label} onChange={(e) => setComps((a) => a.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="e.g. Basic" className="flex-1 min-w-0 rounded border border-slate-200 px-2 py-1 text-xs" />
              <input type="number" step="0.01" min="0" value={c.amount} onChange={(e) => setComps((a) => a.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} className="w-24 rounded border border-slate-200 px-2 py-1 text-xs" />
              <select value={c.kind} onChange={(e) => setComps((a) => a.map((x, j) => (j === i ? { ...x, kind: e.target.value as "earning" | "deduction" } : x)))} className="rounded border border-slate-200 px-1 py-1 text-xs">
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </select>
              <button onClick={() => setComps((a) => a.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600 text-sm">✕</button>
            </div>
          ))}
          <button onClick={() => setComps((a) => [...a, { label: "", amount: 0, kind: "earning" }])} className="text-xs font-medium text-blue-600">+ Add component</button>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setComps(initial?.components ?? []); setCurrency(initial?.currency || "INR"); setEditing(false); }} className="text-xs text-slate-500 px-3 py-1">Cancel</button>
            <button onClick={save} disabled={saving} className="text-xs font-medium text-white bg-slate-900 px-3 py-1 rounded disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Employee documents: upload scanned IDs, signed offer letters / agreements and
// photos of paper docs (stored server-side), view/download them, and remove them.
function DocumentsCard({ employeeId, onError }: { employeeId: string; onError: (s: string) => void }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [type, setType] = useState("id_document");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/documents?employeeId=${employeeId}`);
    if (res.ok) setDocs((await res.json()).documents || []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function upload() {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("employeeId", employeeId);
    fd.set("type", type);
    fd.set("title", title.trim() || file.name);
    const res = await fetch("/api/hr/documents", { method: "POST", body: fd });
    setUploading(false);
    if (!res.ok) { onError((await res.json().catch(() => ({}))).error || "Upload failed"); return; }
    onError("");
    setTitle(""); setFile(null); if (fileRef.current) fileRef.current.value = "";
    load();
  }

  async function del(id: string) {
    if (!confirm("Delete this document?")) return;
    const res = await fetch(`/api/hr/documents/${id}`, { method: "DELETE" });
    if (!res.ok) { onError((await res.json().catch(() => ({}))).error || "Could not delete"); return; }
    load();
  }

  const size = (n: number | null) => (n ? (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`) : "");

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Documents</h3>
      <div className="space-y-1.5 mb-3">
        {docs?.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <span className="text-[10px] font-medium text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">{DOC_TYPES.find((t) => t.value === d.type)?.label || d.type}</span>
            <span className="flex-1 min-w-0 truncate text-slate-700">{d.title}{d.fileSize ? <span className="text-slate-400"> · {size(d.fileSize)}</span> : null}</span>
            {d.fileName ? (
              <a href={`/api/hr/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-600 shrink-0">View</a>
            ) : d.reference ? (
              <a href={d.reference} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-600 shrink-0">Link</a>
            ) : null}
            <button onClick={() => del(d.id)} className="text-slate-400 hover:text-red-600 text-xs shrink-0">Delete</button>
          </div>
        ))}
        {docs && docs.length === 0 && <p className="text-xs text-slate-400">No documents yet.</p>}
        {!docs && <p className="text-xs text-slate-400">Loading…</p>}
      </div>
      <div className="rounded-md border border-slate-200 p-2.5 space-y-2 bg-slate-50">
        <div className="flex gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border border-slate-200 px-2 py-1.5 text-xs bg-white">
            {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="flex-1 min-w-0 rounded border border-slate-200 px-2 py-1.5 text-xs" />
        </div>
        <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-200 file:px-2 file:py-1 file:text-xs" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-400">PDF, PNG, JPG or WebP · up to 10 MB</span>
          <button onClick={upload} disabled={!file || uploading} className="text-xs font-medium text-white bg-slate-900 px-3 py-1.5 rounded disabled:opacity-50">{uploading ? "Uploading…" : "Upload"}</button>
        </div>
      </div>
    </div>
  );
}

function EmployeeModal({ editId, departments, designations, types, employees, onClose, onSaved, onError }: { editId?: string; departments: Ref[]; designations: Ref[]; types: Ref[]; employees: Employee[]; onClose: () => void; onSaved: () => void; onError: (s: string) => void }) {
  const [form, setForm] = useState<Record<string, string>>({ userId: "", email: "", firstName: "", lastName: "", employmentStatus: "active", departmentId: "", designationId: "", employmentTypeId: "", managerUserId: "", joiningDate: "", dateOfBirth: "", workLocation: "", monthlySalary: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editId) {
      fetch(`/api/hr/employees/${editId}`).then(async (r) => {
        if (!r.ok) return;
        const e = (await r.json()).employee;
        setForm({ userId: e.userId, email: "", firstName: e.firstName || "", lastName: e.lastName || "", employmentStatus: e.employmentStatus, departmentId: e.departmentId || "", designationId: e.designationId || "", employmentTypeId: e.employmentTypeId || "", managerUserId: e.managerUserId || "", joiningDate: e.joiningDate || "", dateOfBirth: e.dateOfBirth || "", workLocation: e.workLocation || "", monthlySalary: e.monthlySalary || "", notes: e.notes || "" });
      });
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
              <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="employee@company.com"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                An existing team member&apos;s email links their account; any other email creates the employee directly
                (no system access until you assign modules and a password).
              </p>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Work location (placeholder)</label>
              <input value={form.workLocation} onChange={(e) => set("workLocation", e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Monthly salary (optional)</label>
              <input type="number" step="0.01" min="0" value={form.monthlySalary} onChange={(e) => set("monthlySalary", e.target.value)} placeholder="0.00" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving || (!editId && !form.email.trim())} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// Assigned System Permissions (Enterprise Workspaces): which modules this
// employee can open. Loads via the admin-only modules endpoint — a 403
// simply hides the editor (managers see the profile, admins assign access).
function ModuleAccessCard({ userId }: { userId: string }) {
  const [catalog, setCatalog] = useState<ModuleDef[]>([]);
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [targetRole, setTargetRole] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/users/${userId}/modules`)
      .then(async (r) => {
        if (!r.ok) return; // not an admin — the card simply doesn't render
        const d = await r.json();
        setCatalog(d.catalog || []);
        setAccess(d.effective || {});
        setTargetRole(d.targetRole || "");
        setVisible(true);
      })
      .catch(() => {});
  }, [userId]);

  if (!visible) return null;
  const isAdminTarget = targetRole === "admin";

  async function save() {
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/users/${userId}/modules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modules: access }),
    });
    setSaving(false);
    if (!res.ok) {
      setMessage((await res.json().catch(() => ({}))).error || "Could not save module access.");
      return;
    }
    const d = await res.json();
    setAccess(d.effective || access);
    setMessage("Saved — access applies within a few seconds.");
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Assigned System Permissions</h3>
      {isAdminTarget ? (
        <p className="text-xs text-slate-400">Admins always have every module.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {catalog.map((m) => (
              <label key={m.key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={access[m.key] === true}
                  onChange={(e) => setAccess((a) => ({ ...a, [m.key]: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                {m.label}
              </label>
            ))}
          </div>
          {message && <p className={`text-xs mt-2 ${message.startsWith("Saved") ? "text-emerald-600" : "text-red-600"}`}>{message}</p>}
          <button onClick={save} disabled={saving} className="mt-2 bg-slate-900 text-white text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : "Save permissions"}
          </button>
        </>
      )}
    </div>
  );
}

// Audit History (Enterprise Workspaces): the employee's change log straight
// from the shared audit infrastructure — who, when, previous and new values.
function AuditHistoryCard({ employeeId }: { employeeId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    fetch(`/api/hr/employees/${employeeId}/audit`)
      .then(async (r) => {
        if (r.ok) setEntries((await r.json()).entries || []);
      })
      .catch(() => {});
  }, [employeeId]);

  if (!entries) return null;

  const compact = (v: Record<string, unknown> | null) =>
    v ? Object.entries(v).map(([k, val]) => `${k}: ${val === null ? "—" : String(val)}`).join(", ") : "";

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Audit History</h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {entries.map((e) => (
          <div key={e.id} className="text-xs border-b border-slate-50 pb-1.5 last:border-0">
            <div className="text-slate-800 font-medium">
              {e.action.replace("hr.employee_", "").replace(/_/g, " ")}
              <span className="font-normal text-slate-400"> · {e.actorName || "System"} · {new Date(e.createdAt).toLocaleString()}</span>
            </div>
            {e.before && <div className="text-slate-400 truncate" title={compact(e.before)}>Before: {compact(e.before)}</div>}
            {e.after && <div className="text-slate-500 truncate" title={compact(e.after)}>After: {compact(e.after)}</div>}
          </div>
        ))}
        {entries.length === 0 && <p className="text-xs text-slate-400">No recorded changes yet.</p>}
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
