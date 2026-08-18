"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/hr/shared";

// HR → HR Team. The admin adds HR employees (name + email + temporary
// password); each one logs in and runs the HR workspace themselves — employees,
// offer letters & agreements, documents, departments, designations, org chart,
// reports. They only ever see HR — never the CRM, Finance or Payroll.
// Admin-only (the API 403s everyone else).

type Employee = { id: string; name: string; email: string; active: boolean; createdAt: string };

export default function HRTeamPage() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/hr/team");
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    if (res.ok) setEmployees((await res.json()).employees || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/hr/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage({ kind: "error", text: data.error || "Could not add the HR employee." });
      return;
    }
    setMessage({ kind: "ok", text: `${form.name.trim()} added. Share the temporary password so they can sign in — they'll set their own on first login.` });
    setForm({ name: "", email: "", password: "" });
    setShowAdd(false);
    load();
  }

  if (forbidden) {
    return (
      <div className="p-6">
        <PageHeader title="HR Team" subtitle="Manage who runs HR." />
        <p className="text-sm text-slate-500">Only a company admin can manage the HR team.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title="HR Team"
        subtitle="Add HR employees who log in and run the HR workspace — offer letters, agreements, employees and all HR work. They only ever see HR, never the CRM."
      />
      {message && (
        <p className={`text-sm mb-3 rounded-md border px-3 py-2 ${message.kind === "ok" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-red-700 bg-red-50 border-red-200"}`}>
          {message.text}
        </p>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
        {!showAdd ? (
          <button onClick={() => setShowAdd(true)} className="text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md px-3 py-2">
            + Add HR employee
          </button>
        ) : (
          <form onSubmit={add} className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. Afrin Ahmed" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="hr@company.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Temporary password</label>
                <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" placeholder="min 8 characters" />
              </div>
            </div>
            <p className="text-xs text-slate-400">They sign in with this password once, then must set their own. An invite email is sent as well.</p>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={saving} className="text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md px-3 py-2 disabled:opacity-40">
                {saving ? "Adding…" : "Add HR employee"}
              </button>
              <button type="button" onClick={() => setShowAdd(false)} className="text-sm text-slate-500 hover:text-slate-700 px-2 py-2">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {employees === null && <div className="p-4 text-sm text-slate-400">Loading…</div>}
        {employees && employees.length === 0 && <div className="p-4 text-sm text-slate-400">No HR employees yet.</div>}
        {employees?.map((e) => (
          <EmployeeRow key={e.id} employee={e} onChanged={load} onMessage={setMessage} />
        ))}
      </div>
    </div>
  );
}

function EmployeeRow({ employee, onChanged, onMessage }: { employee: Employee; onChanged: () => void; onMessage: (m: { kind: "ok" | "error"; text: string }) => void }) {
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    const res = await fetch(`/api/hr/team/${employee.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) onMessage({ kind: "error", text: (await res.json().catch(() => ({}))).error || "Could not update." });
    else {
      onMessage({ kind: "ok", text: okText });
      onChanged();
    }
  }
  function resetPassword() {
    const pw = window.prompt(`Set a new temporary password for ${employee.name} (min 8 chars). They'll change it on next sign-in.`);
    if (!pw) return;
    if (pw.length < 8) return onMessage({ kind: "error", text: "Temporary password must be at least 8 characters." });
    patch({ password: pw }, `Password reset for ${employee.name}. Share the new temporary password.`);
  }

  return (
    <div className="p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900 flex items-center gap-2">
          {employee.name}
          <span className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ${employee.active ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"}`}>
            {employee.active ? "Active" : "Deactivated"}
          </span>
        </div>
        <div className="text-xs text-slate-400 truncate">{employee.email} · added {new Date(employee.createdAt).toLocaleDateString()}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={resetPassword} disabled={busy} className="text-xs font-medium text-slate-600 hover:text-slate-800 px-2 py-1 disabled:opacity-40">
          Reset password
        </button>
        {employee.active ? (
          <button
            onClick={() => window.confirm(`Deactivate ${employee.name}? They will be signed out immediately and can no longer log in.`) && patch({ active: false }, `${employee.name} deactivated.`)}
            disabled={busy}
            className="text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md px-2.5 py-1 disabled:opacity-40"
          >
            Deactivate
          </button>
        ) : (
          <button onClick={() => patch({ active: true }, `${employee.name} reactivated.`)} disabled={busy} className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md px-2.5 py-1 disabled:opacity-40">
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}
