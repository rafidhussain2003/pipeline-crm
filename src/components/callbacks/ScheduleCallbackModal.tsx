"use client";

import { useState } from "react";

const REASONS = [
  "Customer requested callback",
  "Busy right now",
  "Requested after work",
  "Requested next week",
  "Payment pending",
  "Installation follow-up",
  "Other",
];
const PRIORITIES = ["low", "normal", "high", "urgent"];

// Quick presets — the common case is "call me back in an hour", not picking a
// date from a calendar.
const PRESETS: { label: string; minutes: number }[] = [
  { label: "In 1 hour", minutes: 60 },
  { label: "In 3 hours", minutes: 180 },
  { label: "Tomorrow 10am", minutes: -1 }, // handled specially below
  { label: "Next week", minutes: 7 * 24 * 60 },
];

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time — toISOString() would
// silently shift the value by the UTC offset.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ScheduleCallbackModal({
  leadId,
  leadName,
  existingId,
  initial,
  onClose,
  onSaved,
}: {
  leadId: string;
  leadName?: string | null;
  existingId?: string; // present → this is a reschedule
  initial?: { scheduledAt?: string; reason?: string; notes?: string | null; priority?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [when, setWhen] = useState(initial?.scheduledAt ? toLocalInput(new Date(initial.scheduledAt)) : toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [reason, setReason] = useState(initial?.reason || REASONS[0]);
  const [notes, setNotes] = useState(initial?.notes || "");
  const [priority, setPriority] = useState(initial?.priority || "normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The agent's own timezone, captured automatically — never asked for.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  function applyPreset(p: { label: string; minutes: number }) {
    if (p.minutes === -1) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      setWhen(toLocalInput(d));
      return;
    }
    setWhen(toLocalInput(new Date(Date.now() + p.minutes * 60_000)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const scheduledAt = new Date(when).toISOString();
    const res = existingId
      ? await fetch(`/api/callbacks/${existingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reschedule", scheduledAt, reason, notes, priority, timezone }),
        })
      : await fetch("/api/callbacks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, scheduledAt, reason, notes, priority, timezone }),
        });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save the callback.");
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">{existingId ? "Reschedule callback" : "Schedule a callback"}</h2>
        {leadName && <p className="text-xs text-slate-500 mt-0.5">{leadName}</p>}

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">When</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => applyPreset(p)} className="text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full px-2.5 py-1">
                  {p.label}
                </button>
              ))}
            </div>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
            <p className="text-[11px] text-slate-400 mt-1">Your timezone: {timezone}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Priority</label>
            <div className="flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 text-xs font-medium rounded-md px-2 py-1.5 capitalize border ${
                    priority === p ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything the callback should remember…" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {saving ? "Saving…" : existingId ? "Reschedule" : "Schedule callback"}
          </button>
        </div>
      </div>
    </div>
  );
}
