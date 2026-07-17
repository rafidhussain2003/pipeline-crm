"use client";

import { useEffect, useState } from "react";
import { fmtShiftTime, PageHeader } from "@/components/attendance/shared";

type Shift = {
  id: string; name: string; startMinute: number; endMinute: number; graceMinutes: number;
  veryLateMinutes: number; earlyLeaveMinutes: number; flexible: boolean; timezone: string | null;
  isSystem: boolean; active: boolean;
};

function toMinute(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h % 24) * 60 + (m || 0);
}
function toTimeInput(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [modal, setModal] = useState<null | { edit?: Shift }>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/attendance/shifts");
    if (res.ok) setShifts((await res.json()).shifts || []);
  };
  useEffect(() => { load(); }, []);

  async function toggleActive(s: Shift) {
    await fetch(`/api/attendance/shifts/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !s.active }) });
    load();
  }
  async function remove(s: Shift) {
    setError("");
    const res = await fetch(`/api/attendance/shifts/${s.id}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Could not delete");
    load();
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title="Shifts"
        subtitle="Working windows with grace periods. A shift ending before it starts crosses midnight (night shift)."
        action={<button onClick={() => setModal({})} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Add shift</button>}
      />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {shifts.map((s) => (
          <div key={s.id} className={`flex items-center gap-3 px-4 py-3 ${s.active ? "" : "opacity-50"}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 flex items-center gap-2">
                {s.name}
                {s.isSystem && <span className="text-[10px] font-semibold uppercase text-slate-400">Default</span>}
                {s.endMinute < s.startMinute && !s.flexible && <span className="text-[10px] font-semibold uppercase text-indigo-500">Overnight</span>}
              </div>
              <div className="text-xs text-slate-400">
                {s.flexible ? "Flexible — no late/early evaluation" : `${fmtShiftTime(s.startMinute)} – ${fmtShiftTime(s.endMinute)} · grace ${s.graceMinutes}m · very late after ${s.graceMinutes + s.veryLateMinutes}m`}
                {s.timezone ? ` · ${s.timezone}` : ""}
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => setModal({ edit: s })} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">Edit</button>
              <button onClick={() => toggleActive(s)} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded px-2 py-1">{s.active ? "Deactivate" : "Activate"}</button>
              {!s.isSystem && <button onClick={() => remove(s)} className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1">Delete</button>}
            </div>
          </div>
        ))}
      </div>

      {modal && <ShiftModal edit={modal.edit} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
    </div>
  );
}

function ShiftModal({ edit, onClose, onSaved }: { edit?: Shift; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(edit?.name || "");
  const [start, setStart] = useState(edit ? toTimeInput(edit.startMinute) : "09:00");
  const [end, setEnd] = useState(edit ? toTimeInput(edit.endMinute) : "17:00");
  const [grace, setGrace] = useState(String(edit?.graceMinutes ?? 10));
  const [veryLate, setVeryLate] = useState(String(edit?.veryLateMinutes ?? 30));
  const [earlyLeave, setEarlyLeave] = useState(String(edit?.earlyLeaveMinutes ?? 15));
  const [flexible, setFlexible] = useState(edit?.flexible ?? false);
  const [timezone, setTimezone] = useState(edit?.timezone || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const payload = {
      name,
      startMinute: toMinute(start),
      endMinute: toMinute(end),
      graceMinutes: Number(grace),
      veryLateMinutes: Number(veryLate),
      earlyLeaveMinutes: Number(earlyLeave),
      flexible,
      timezone: timezone || null,
    };
    const res = edit
      ? await fetch(`/api/attendance/shifts/${edit.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/attendance/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
        <h2 className="text-base font-semibold text-slate-900 mb-4">{edit ? `Edit ${edit.name}` : "Add shift"}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend shift" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} />
            Flexible (no fixed hours — skip late/early evaluation)
          </label>
          {!flexible && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Starts</label>
                  <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ends</label>
                  <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Grace (min)</label>
                  <input type="number" min="0" max="480" value={grace} onChange={(e) => setGrace(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Very late after +</label>
                  <input type="number" min="0" max="480" value={veryLate} onChange={(e) => setVeryLate(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Early leave (min)</label>
                  <input type="number" min="0" max="480" value={earlyLeave} onChange={(e) => setEarlyLeave(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Timezone (optional — defaults to company)</label>
                <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
              </div>
            </>
          )}
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
