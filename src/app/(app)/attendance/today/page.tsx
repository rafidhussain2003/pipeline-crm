"use client";

import { useEffect, useState } from "react";
import { Badge, fmtMinutes, fmtShiftTime, fmtTime, LATE_STYLES, DEPARTURE_STYLES, PageHeader } from "@/components/attendance/shared";

type Today = {
  record: {
    id: string; checkInAt: string; checkOutAt: string | null; lateStatus: string | null; lateMinutes: number;
    departureStatus: string | null; breakMinutes: number; workedMinutes: number | null;
  } | null;
  breaks: { id: string; startAt: string; endAt: string | null; durationMinutes: number | null }[];
  shift: { name: string; startMinute: number; endMinute: number; flexible: boolean; graceMinutes: number } | null;
  timezone: string;
  workDate: string;
  onBreak: boolean;
};

export default function TodayPage() {
  const [data, setData] = useState<Today | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/attendance/self");
    if (res.ok) setData(await res.json());
  };
  useEffect(() => { load(); }, []);

  async function act(action: string) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/attendance/self", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    setBusy(false);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || "Action failed");
    load();
  }

  if (!data) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  const rec = data.record;
  const working = !!rec && !rec.checkOutAt;

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Today" subtitle={`${data.workDate} · ${data.timezone}${data.shift ? ` · ${data.shift.name}${data.shift.flexible ? " (flexible)" : ` ${fmtShiftTime(data.shift.startMinute)}–${fmtShiftTime(data.shift.endMinute)}`}` : ""}`} />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg p-6 text-center">
        {!rec && (
          <>
            <p className="text-sm text-slate-500 mb-4">You haven&apos;t checked in today.</p>
            <button onClick={() => act("check_in")} disabled={busy} className="bg-emerald-600 text-white text-sm font-semibold px-8 py-3 rounded-md disabled:opacity-50">
              Check In
            </button>
          </>
        )}
        {rec && (
          <>
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-2xl font-semibold text-slate-900">{fmtTime(rec.checkInAt)}</span>
              <Badge value={rec.lateStatus} styles={LATE_STYLES} />
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Checked in{rec.lateMinutes > 0 ? ` · ${rec.lateMinutes} min after shift start` : ""}
              {rec.checkOutAt ? ` — checked out ${fmtTime(rec.checkOutAt)}` : data.onBreak ? " — on break" : " — working"}
            </p>

            {working && (
              <div className="flex items-center justify-center gap-2">
                {data.onBreak ? (
                  <button onClick={() => act("break_end")} disabled={busy} className="bg-amber-500 text-white text-sm font-medium px-5 py-2.5 rounded-md disabled:opacity-50">End Break</button>
                ) : (
                  <button onClick={() => act("break_start")} disabled={busy} className="bg-slate-100 text-slate-700 text-sm font-medium px-5 py-2.5 rounded-md disabled:opacity-50">Start Break</button>
                )}
                <button onClick={() => act("check_out")} disabled={busy} className="bg-slate-900 text-white text-sm font-semibold px-6 py-2.5 rounded-md disabled:opacity-50">Check Out</button>
              </div>
            )}

            {rec.checkOutAt && (
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div className="bg-slate-50 rounded-md p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Worked</div>
                  <div className="text-sm font-semibold text-slate-800 mt-0.5">{fmtMinutes(rec.workedMinutes)}</div>
                </div>
                <div className="bg-slate-50 rounded-md p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Breaks</div>
                  <div className="text-sm font-semibold text-slate-800 mt-0.5">{fmtMinutes(rec.breakMinutes)}</div>
                </div>
                <div className="bg-slate-50 rounded-md p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Departure</div>
                  <div className="mt-1"><Badge value={rec.departureStatus} styles={DEPARTURE_STYLES} /></div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {data.breaks.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 mt-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Breaks today</h2>
          <div className="space-y-1.5">
            {data.breaks.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{fmtTime(b.startAt)} → {b.endAt ? fmtTime(b.endAt) : "running…"}</span>
                <span className="text-slate-400 text-xs">{b.durationMinutes !== null ? fmtMinutes(b.durationMinutes) : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
