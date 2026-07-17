"use client";

import { useEffect, useState } from "react";
import { Badge, fmtMinutes, fmtTime, LATE_STYLES, DEPARTURE_STYLES, PageHeader } from "@/components/attendance/shared";

type Record_ = {
  id: string; userId: string; userName: string; workDate: string; checkInAt: string; checkOutAt: string | null;
  lateStatus: string | null; lateMinutes: number; departureStatus: string | null;
  breakMinutes: number; workedMinutes: number | null; manualAdjusted: boolean; shiftName: string | null;
};

export default function AttendanceLogsPage() {
  const [records, setRecords] = useState<Record_[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [adjust, setAdjust] = useState<Record_ | null>(null);

  const load = async () => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const res = await fetch(`/api/attendance/records?${p}`);
    if (res.ok) setRecords((await res.json()).records || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Attendance Logs" subtitle="Every day record. Corrections require a reason and are fully audited." />

      <div className="flex gap-2 mb-4">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="text-left font-medium px-4 py-2">Date</th>
              <th className="text-left font-medium px-2 py-2">Employee</th>
              <th className="text-left font-medium px-2 py-2">Shift</th>
              <th className="text-left font-medium px-2 py-2">In / Out</th>
              <th className="text-left font-medium px-2 py-2">Status</th>
              <th className="text-right font-medium px-2 py-2">Worked</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{r.workDate}</td>
                <td className="px-2 py-2 text-slate-900 font-medium max-w-[160px] truncate">
                  {r.userName}
                  {r.manualAdjusted && <span className="ml-1.5 text-[10px] font-semibold uppercase text-amber-500">Adjusted</span>}
                </td>
                <td className="px-2 py-2 text-slate-500 text-xs">{r.shiftName || "—"}</td>
                <td className="px-2 py-2 text-slate-600 whitespace-nowrap text-xs">{fmtTime(r.checkInAt)} – {r.checkOutAt ? fmtTime(r.checkOutAt) : "…"}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-1">
                    <Badge value={r.lateStatus} styles={LATE_STYLES} />
                    <Badge value={r.departureStatus} styles={DEPARTURE_STYLES} />
                  </div>
                </td>
                <td className="px-2 py-2 text-right text-slate-900">{fmtMinutes(r.workedMinutes)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => setAdjust(r)} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">Adjust</button>
                </td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No attendance records{from || to ? " in this range" : " yet"}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {adjust && <AdjustModal record={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); load(); }} />}
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AdjustModal({ record, onClose, onSaved }: { record: Record_; onClose: () => void; onSaved: () => void }) {
  const [checkInAt, setCheckInAt] = useState(toLocalInput(record.checkInAt));
  const [checkOutAt, setCheckOutAt] = useState(toLocalInput(record.checkOutAt));
  const [lateStatus, setLateStatus] = useState(record.lateStatus || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/attendance/records/${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkInAt: checkInAt ? new Date(checkInAt).toISOString() : undefined,
        checkOutAt: checkOutAt ? new Date(checkOutAt).toISOString() : null,
        lateStatus: lateStatus || undefined,
        reason,
      }),
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
        <h2 className="text-base font-semibold text-slate-900 mb-1">Adjust attendance</h2>
        <p className="text-xs text-slate-400 mb-4">{record.userName} · {record.workDate}. The previous values are preserved in the audit trail.</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Check-in</label>
              <input type="datetime-local" value={checkInAt} onChange={(e) => setCheckInAt(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Check-out</label>
              <input type="datetime-local" value={checkOutAt} onChange={(e) => setCheckOutAt(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Late status</label>
            <select value={lateStatus} onChange={(e) => setLateStatus(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Keep current</option>
              <option value="on_time">On time</option>
              <option value="late">Late</option>
              <option value="very_late">Very late</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Reason (required)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why is this correction needed?" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving || !reason.trim()} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : "Save correction"}
          </button>
        </div>
      </div>
    </div>
  );
}
