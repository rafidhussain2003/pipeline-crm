"use client";

import { useEffect, useState } from "react";
import { money, PageHeader, StatusBadge } from "@/components/payroll/shared";

// Overtime is DERIVED from attendance and computed inside each payroll run — it
// isn't separately editable. This page surfaces the overtime paid per run (from
// the immutable items) plus the configured multiplier.
type Run = { id: string; label: string; periodStart: string; periodEnd: string; status: string };
type Item = { userName: string; overtimeMinutes: number; overtimeCents: number };

export default function OvertimePage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ run: Run; items: Item[] } | null>(null);

  useEffect(() => {
    fetch("/api/payroll/runs").then(async (r) => { if (r.ok) setRuns((await r.json()).runs || []); });
    fetch("/api/payroll/settings").then(async (r) => { if (r.ok) setMultiplier((await r.json()).settings.overtimeMultiplier); });
  }, []);

  async function open(run: Run) {
    const res = await fetch(`/api/payroll/runs/${run.id}`);
    if (res.ok) {
      const full = (await res.json()).run;
      setSelected({ run, items: (full.items as Item[]).filter((i) => i.overtimeMinutes > 0) });
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Overtime" subtitle={`Overtime is read from Attendance and paid at ${multiplier ?? "—"}× the hourly rate. Configure the multiplier in Settings.`} />

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {runs.map((r) => (
          <button key={r.id} onClick={() => open(r)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{r.label}</div>
              <div className="text-xs text-slate-400">{r.periodStart} → {r.periodEnd}</div>
            </div>
            <StatusBadge status={r.status} />
          </button>
        ))}
        {runs.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No payroll runs yet.</p>}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 mb-3">Overtime — {selected.run.label}</h2>
            <div className="space-y-1.5">
              {selected.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-slate-100 pb-1.5 last:border-0">
                  <span className="text-slate-700">{it.userName}</span>
                  <span className="text-slate-500">{(it.overtimeMinutes / 60).toFixed(1)}h · <span className="font-medium text-slate-800">{money(it.overtimeCents)}</span></span>
                </div>
              ))}
              {selected.items.length === 0 && <p className="text-xs text-slate-400">No overtime in this run.</p>}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setSelected(null)} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
