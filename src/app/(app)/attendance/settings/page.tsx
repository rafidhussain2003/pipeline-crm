"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/attendance/shared";

type Settings = { defaultShiftId: string | null; weekendDays: number[] };
type Shift = { id: string; name: string; active: boolean };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AttendanceSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = async () => {
    const [sRes, shRes] = await Promise.all([fetch("/api/attendance/settings"), fetch("/api/attendance/shifts")]);
    if (sRes.ok) setSettings((await sRes.json()).settings);
    if (shRes.ok) setShifts((await shRes.json()).shifts || []);
  };
  useEffect(() => { load(); }, []);

  async function save(patch: Partial<Settings>) {
    setMessage(null);
    const res = await fetch("/api/attendance/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) setMessage({ kind: "error", text: (await res.json().catch(() => ({}))).error || "Could not save" });
    else setMessage({ kind: "ok", text: "Saved." });
    load();
  }

  if (!settings) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Attendance Settings" subtitle="Module-wide configuration for this company." />
      {message && <p className={`text-xs mb-3 ${message.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{message.text}</p>}

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Default shift</h2>
        <p className="text-xs text-slate-400 mb-3">Used for anyone without a personal shift assignment.</p>
        <select
          value={settings.defaultShiftId || ""}
          onChange={(e) => save({ defaultShiftId: (e.target.value || null) as Settings["defaultShiftId"] })}
          className="w-full max-w-xs rounded-md border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">No default (flexible)</option>
          {shifts.filter((s) => s.active).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Weekend days</h2>
        <p className="text-xs text-slate-400 mb-3">Days that never count toward absence.</p>
        <div className="flex gap-1.5">
          {DAYS.map((label, day) => {
            const on = settings.weekendDays.includes(day);
            return (
              <button
                key={day}
                onClick={() => save({ weekendDays: on ? settings.weekendDays.filter((d) => d !== day) : [...settings.weekendDays, day] })}
                className={`text-xs font-medium rounded-md px-3 py-2 ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
