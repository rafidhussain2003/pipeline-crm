"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/finance/shared";

// The capability toggles the admin controls per employee. Order + copy live
// here (a client component can't import the server-only permissions module);
// the keys MUST match FINANCE_CAPABILITIES in lib/finance/permissions.ts.
const CAPS = [
  { key: "record_expense", label: "Record expenses", desc: "Add business expenses & salary payments (money out)." },
  { key: "record_payout", label: "Record customer payouts", desc: "Log payouts made to customers (money out)." },
  { key: "record_income", label: "Record client payments", desc: "Log payments / other income received from clients (money in)." },
  { key: "view_reports", label: "View ledger & reports", desc: "Read the general ledger, journal entries and reports." },
  { key: "view_balances", label: "View balances & funds", desc: "See cash/bank/asset balances & dashboard totals. Off by default." },
  { key: "manage", label: "Manage accounts & settings", desc: "Chart of accounts, financial years, currency, voids. Advanced." },
] as const;
type Caps = Record<string, boolean>;

type Employee = { id: string; name: string; email: string; active: boolean; capabilities: Caps; createdAt: string };

const emptyCaps = (): Caps => Object.fromEntries(CAPS.map((c) => [c.key, false]));

export default function FinanceTeamPage() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; password: string; caps: Caps }>({
    name: "",
    email: "",
    password: "",
    caps: { ...emptyCaps(), record_expense: true }, // sensible default; balances stays OFF
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/finance/team");
    if (res.status === 403) {
      setForbidden(true);
      setEmployees([]);
      return;
    }
    if (res.ok) setEmployees((await res.json()).employees || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function addEmployee() {
    setMessage(null);
    setSaving(true);
    const res = await fetch("/api/finance/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, email: form.email, password: form.password, capabilities: form.caps }),
    });
    setSaving(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: (await res.json().catch(() => ({}))).error || "Could not add employee" });
      return;
    }
    setMessage({ kind: "ok", text: `${form.name.trim()} added. Share the temporary password so they can sign in.` });
    setShowAdd(false);
    setForm({ name: "", email: "", password: "", caps: { ...emptyCaps(), record_expense: true } });
    load();
  }

  if (employees === null) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (forbidden) {
    return (
      <div className="p-6 max-w-2xl">
        <PageHeader title="Finance Team" subtitle="Manage who can work in your books." />
        <p className="text-sm text-slate-500">Only an admin can manage finance employees.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Finance Team" subtitle="Add finance employees and control exactly what each can do. They only ever see Finance — never the CRM." />

      {message && <p className={`text-xs mb-3 ${message.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{message.text}</p>}

      <div className="mb-4">
        {!showAdd ? (
          <button onClick={() => setShowAdd(true)} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
            + Add finance employee
          </button>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">New finance employee</h2>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
              <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" type="email" className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
              <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Temporary password" className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">What they can do</div>
            <div className="space-y-2 mb-4">
              {CAPS.map((c) => (
                <label key={c.key} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.caps[c.key]}
                    onChange={(e) => setForm((f) => ({ ...f, caps: { ...f.caps, [c.key]: e.target.checked } }))}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    <span className="block text-sm text-slate-800">{c.label}</span>
                    <span className="block text-[11px] text-slate-400">{c.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={addEmployee} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40">
                {saving ? "Adding…" : "Add employee"}
              </button>
              <button onClick={() => setShowAdd(false)} className="text-sm font-medium text-slate-500 px-2 py-2">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {employees.length === 0 ? (
        <p className="text-sm text-slate-400">No finance employees yet.</p>
      ) : (
        <div className="space-y-3">
          {employees.map((e) => (
            <EmployeeCard key={e.id} employee={e} onChanged={load} onMessage={setMessage} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeCard({
  employee,
  onChanged,
  onMessage,
}: {
  employee: Employee;
  onChanged: () => void;
  onMessage: (m: { kind: "ok" | "error"; text: string }) => void;
}) {
  const [caps, setCaps] = useState<Caps>({ ...emptyCaps(), ...employee.capabilities });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const granted = CAPS.filter((c) => caps[c.key]);

  async function patch(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    const res = await fetch(`/api/finance/team/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      onMessage({ kind: "error", text: (await res.json().catch(() => ({}))).error || "Could not update" });
      return false;
    }
    onMessage({ kind: "ok", text: okText });
    onChanged();
    return true;
  }

  async function saveCaps() {
    if (await patch({ capabilities: caps }, `Updated ${employee.name}'s access.`)) setEditing(false);
  }

  async function resetPassword() {
    const pw = window.prompt(`Set a new temporary password for ${employee.name} (min 8 chars). They'll change it on next sign-in.`);
    if (!pw) return;
    await patch({ password: pw }, `Password reset for ${employee.name}.`);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{employee.name}</span>
            {!employee.active && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">Disabled</span>}
          </div>
          <div className="text-xs text-slate-500">{employee.email}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => patch({ active: !employee.active }, employee.active ? `${employee.name} disabled.` : `${employee.name} re-enabled.`)} disabled={busy} className="text-xs font-medium text-slate-600 hover:text-slate-800 px-2 py-1">
            {employee.active ? "Disable" : "Enable"}
          </button>
          <button onClick={resetPassword} disabled={busy} className="text-xs font-medium text-slate-600 hover:text-slate-800 px-2 py-1">Reset password</button>
          <button onClick={() => setEditing((v) => !v)} className="text-xs font-semibold text-blue-700 hover:text-blue-900 px-2 py-1">{editing ? "Close" : "Edit access"}</button>
        </div>
      </div>

      {!editing ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {granted.length === 0 ? (
            <span className="text-[11px] text-slate-400">No capabilities yet — click “Edit access”.</span>
          ) : (
            granted.map((c) => (
              <span key={c.key} className="text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">{c.label}</span>
            ))
          )}
        </div>
      ) : (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="space-y-2 mb-3">
            {CAPS.map((c) => (
              <label key={c.key} className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={!!caps[c.key]} onChange={(e) => setCaps((prev) => ({ ...prev, [c.key]: e.target.checked }))} className="mt-0.5 rounded border-slate-300" />
                <span>
                  <span className="block text-sm text-slate-800">{c.label}</span>
                  <span className="block text-[11px] text-slate-400">{c.desc}</span>
                </span>
              </label>
            ))}
          </div>
          <button onClick={saveCaps} disabled={busy} className="bg-slate-900 text-white text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-40">
            {busy ? "Saving…" : "Save access"}
          </button>
        </div>
      )}
    </div>
  );
}
