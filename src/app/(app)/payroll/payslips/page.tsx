"use client";

import { useEffect, useState } from "react";
import { money, PageHeader, StatusBadge } from "@/components/payroll/shared";

type Slip = { itemId: string; runLabel: string; periodStart: string; periodEnd: string; payDate: string; status: string; grossCents: number; netCents: number };
type Line = { label: string; amountCents: number };
type Payslip = {
  runLabel: string; issued: boolean; period: { start: string; end: string; payDate: string };
  employee: { name: string; email: string };
  company: { name: string; address: string | null; supportEmail: string | null; businessPhone: string | null } | null;
  amounts: { grossCents: number; deductionsCents: number; leaveAdjustmentCents: number; netCents: number };
  attendance: { presentDays: number; leaveDays: number; absentDays: number; overtimeMinutes: number; lateDays: number } | null;
  breakdown: { earnings: Line[]; deductions: Line[] } | null;
};

export default function PayslipsPage() {
  const [slips, setSlips] = useState<Slip[]>([]);
  const [open, setOpen] = useState<Payslip | null>(null);

  useEffect(() => {
    fetch("/api/payroll/payslips").then(async (r) => {
      if (r.ok) setSlips((await r.json()).payslips || []);
    });
  }, []);

  async function view(itemId: string) {
    const res = await fetch(`/api/payroll/payslips/${itemId}`);
    if (res.ok) setOpen((await res.json()).payslip);
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Payslips" subtitle="Your salary slips. Each is a permanent record of an approved payroll run." />

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {slips.map((s) => (
          <button key={s.itemId} onClick={() => view(s.itemId)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{s.runLabel}</div>
              <div className="text-xs text-slate-400">{s.periodStart} → {s.periodEnd} · paid {s.payDate}</div>
            </div>
            <StatusBadge status={s.status} />
            <span className="text-sm font-semibold text-slate-900 w-24 text-right">{money(s.netCents)}</span>
          </button>
        ))}
        {slips.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No payslips yet.</p>}
      </div>

      {open && <PayslipModal slip={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PayslipModal({ slip, onClose }: { slip: Payslip; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Company header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-3 mb-3">
          <div>
            <div className="text-base font-semibold text-slate-900">{slip.company?.name || "Payslip"}</div>
            {slip.company?.address && <div className="text-[11px] text-slate-400">{slip.company.address}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-700">PAYSLIP</div>
            <div className="text-[11px] text-slate-400">{slip.period.start} → {slip.period.end}</div>
          </div>
        </div>

        {!slip.issued && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-3">Draft — not yet approved.</p>}

        <div className="grid grid-cols-2 gap-y-1 text-sm mb-4">
          <div className="text-slate-400 text-xs">Employee</div>
          <div className="text-right font-medium text-slate-800">{slip.employee.name}</div>
          <div className="text-slate-400 text-xs">Pay date</div>
          <div className="text-right text-slate-700">{slip.period.payDate}</div>
        </div>

        {/* Earnings */}
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Earnings</div>
          {slip.breakdown?.earnings.map((l, i) => (
            <div key={i} className="flex justify-between text-sm py-0.5"><span className="text-slate-600">{l.label}</span><span className="text-slate-800">{money(l.amountCents)}</span></div>
          ))}
          <div className="flex justify-between text-sm font-semibold border-t border-slate-100 mt-1 pt-1"><span>Gross</span><span>{money(slip.amounts.grossCents)}</span></div>
        </div>

        {/* Deductions */}
        {slip.breakdown && slip.breakdown.deductions.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Deductions</div>
            {slip.breakdown.deductions.map((l, i) => (
              <div key={i} className="flex justify-between text-sm py-0.5"><span className="text-slate-600">{l.label}</span><span className="text-slate-800">−{money(l.amountCents)}</span></div>
            ))}
          </div>
        )}

        <div className="flex justify-between text-base font-semibold border-t-2 border-slate-800 pt-2 mb-4">
          <span>Net pay</span><span>{money(slip.amounts.netCents)}</span>
        </div>

        {/* Attendance summary */}
        {slip.attendance && (
          <div className="bg-slate-50 rounded-md p-3 grid grid-cols-3 gap-2 text-center mb-1">
            {[
              ["Present", `${slip.attendance.presentDays}d`],
              ["Leave", `${slip.attendance.leaveDays}d`],
              ["Absent", `${slip.attendance.absentDays}d`],
              ["Late", `${slip.attendance.lateDays}d`],
              ["Overtime", `${(slip.attendance.overtimeMinutes / 60).toFixed(1)}h`],
            ].map(([label, v]) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
                <div className="text-sm font-medium text-slate-800">{v}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}
