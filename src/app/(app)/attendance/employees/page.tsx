"use client";

import { useEffect, useState } from "react";
import { Badge, fmtMinutes, fmtTime, LATE_STYLES, PageHeader } from "@/components/attendance/shared";

type Employee = {
  id: string; name: string; email: string; role: string;
  shiftId: string | null; shiftName: string | null;
  checkInAt: string | null; checkOutAt: string | null; lateStatus: string | null; workedMinutes: number | null;
};
type Shift = { id: string; name: string; active: boolean };

export default function AttendanceEmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [workDate, setWorkDate] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [empRes, shiftRes] = await Promise.all([fetch("/api/attendance/employees"), fetch("/api/attendance/shifts")]);
    if (empRes.ok) {
      const d = await empRes.json();
      setEmployees(d.employees || []);
      setWorkDate(d.workDate || "");
    }
    if (shiftRes.ok) setShifts((await shiftRes.json()).shifts || []);
  };
  useEffect(() => { load(); }, []);

  async function assign(userId: string, shiftId: string) {
    setError("");
    const res = await fetch("/api/attendance/employees", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, shiftId: shiftId || null }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not assign shift");
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Employees" subtitle={`Everyone's shift and today's status (${workDate}).`} />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {employees.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{e.name}</div>
              <div className="text-xs text-slate-400 capitalize">{e.role}</div>
            </div>
            <select
              value={e.shiftId || ""}
              onChange={(ev) => assign(e.id, ev.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600"
            >
              <option value="">Default shift</option>
              {shifts.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div className="w-40 text-right">
              {e.checkInAt ? (
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-slate-500">
                    {fmtTime(e.checkInAt)}{e.checkOutAt ? ` – ${fmtTime(e.checkOutAt)}` : ""}
                  </span>
                  <Badge value={e.lateStatus} styles={LATE_STYLES} />
                </div>
              ) : (
                <span className="text-xs text-slate-300">Not checked in</span>
              )}
              {e.workedMinutes !== null && <div className="text-[11px] text-slate-400 mt-0.5">{fmtMinutes(e.workedMinutes)}</div>}
            </div>
          </div>
        ))}
        {employees.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No active employees.</p>}
      </div>
    </div>
  );
}
