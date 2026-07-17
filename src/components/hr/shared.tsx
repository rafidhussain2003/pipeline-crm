"use client";

// Phase 22 — shared HR UI atoms.
export const STATUS_STYLES: Record<string, string> = {
  active: "text-emerald-700 bg-emerald-50",
  probation: "text-sky-700 bg-sky-50",
  on_notice: "text-amber-700 bg-amber-50",
  inactive: "text-slate-500 bg-slate-100",
  terminated: "text-red-700 bg-red-50",
};
export const EMPLOYMENT_STATUSES = ["active", "probation", "on_notice", "inactive", "terminated"];

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLES[status] || "text-slate-500 bg-slate-100"}`}>
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

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm text-slate-800 mt-0.5">{value || "—"}</div>
    </div>
  );
}
