"use client";

// Phase 21 — shared payroll UI atoms. All amounts arrive as integer CENTS.
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtMinutesAsHours(min: number | null | undefined): string {
  if (!min) return "0h";
  return `${(min / 60).toFixed(1)}h`;
}

export const RUN_STATUS_STYLES: Record<string, string> = {
  draft: "text-slate-500 bg-slate-100",
  calculated: "text-amber-700 bg-amber-50",
  approved: "text-blue-700 bg-blue-50",
  locked: "text-indigo-700 bg-indigo-50",
  paid: "text-emerald-700 bg-emerald-50",
};

export function StatusBadge({ status, styles }: { status: string; styles?: Record<string, string> }) {
  const map = styles ?? RUN_STATUS_STYLES;
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${map[status] || "text-slate-500 bg-slate-100"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
