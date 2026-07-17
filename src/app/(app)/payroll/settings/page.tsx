"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/payroll/shared";

type Settings = {
  defaultFrequency: string; overtimeMultiplier: number; standardWorkdayMinutes: number;
  standardWorkdaysPerMonth: number; payDayOfMonth: number;
  salaryExpenseAccountCode: string; salaryPayableAccountCode: string; defaultPaymentAccountCode: string;
};

export default function PayrollSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = async () => {
    const res = await fetch("/api/payroll/settings");
    if (res.ok) setS((await res.json()).settings);
  };
  useEffect(() => { load(); }, []);

  async function save(patch: Partial<Settings>) {
    setMessage(null);
    const res = await fetch("/api/payroll/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) setMessage({ kind: "error", text: (await res.json().catch(() => ({}))).error || "Could not save" });
    else { setMessage({ kind: "ok", text: "Saved." }); load(); }
  }

  if (!s) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const num = (v: string, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Payroll Settings" subtitle="Company-wide payroll configuration." />
      {message && <p className={`text-xs mb-3 ${message.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{message.text}</p>}

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Calculation</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Default frequency">
            <select defaultValue={s.defaultFrequency} onBlur={(e) => save({ defaultFrequency: e.target.value })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm capitalize">
              {["monthly", "weekly", "biweekly", "hourly"].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Overtime multiplier">
            <input type="number" step="0.1" min="1" max="5" defaultValue={s.overtimeMultiplier} onBlur={(e) => save({ overtimeMultiplier: num(e.target.value, s.overtimeMultiplier) })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </Field>
          <Field label="Standard workday (minutes)">
            <input type="number" min="60" max="1440" defaultValue={s.standardWorkdayMinutes} onBlur={(e) => save({ standardWorkdayMinutes: num(e.target.value, s.standardWorkdayMinutes) })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </Field>
          <Field label="Standard workdays / month">
            <input type="number" min="1" max="31" defaultValue={s.standardWorkdaysPerMonth} onBlur={(e) => save({ standardWorkdaysPerMonth: num(e.target.value, s.standardWorkdaysPerMonth) })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </Field>
          <Field label="Pay day of month">
            <input type="number" min="1" max="28" defaultValue={s.payDayOfMonth} onBlur={(e) => save({ payDayOfMonth: num(e.target.value, s.payDayOfMonth) })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </Field>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Finance accounts</h2>
        <p className="text-[11px] text-slate-400 -mt-2">Which accounts the payroll accrual and payment journals post to. Salary Payable is created automatically if it doesn&apos;t exist.</p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Salary expense">
            <input defaultValue={s.salaryExpenseAccountCode} onBlur={(e) => save({ salaryExpenseAccountCode: e.target.value })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </Field>
          <Field label="Salary payable">
            <input defaultValue={s.salaryPayableAccountCode} onBlur={(e) => save({ salaryPayableAccountCode: e.target.value })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </Field>
          <Field label="Default payment (cash/bank)">
            <input defaultValue={s.defaultPaymentAccountCode} onBlur={(e) => save({ defaultPaymentAccountCode: e.target.value })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
