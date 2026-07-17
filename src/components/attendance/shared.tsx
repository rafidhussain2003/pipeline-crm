"use client";

// Phase 20 — shared attendance UI atoms.
export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtShiftTime(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const LATE_STYLES: Record<string, string> = {
  on_time: "text-emerald-700 bg-emerald-50",
  late: "text-amber-700 bg-amber-50",
  very_late: "text-red-700 bg-red-50",
};
export const DEPARTURE_STYLES: Record<string, string> = {
  normal: "text-slate-600 bg-slate-100",
  left_early: "text-amber-700 bg-amber-50",
  overtime: "text-sky-700 bg-sky-50",
};
export const LEAVE_STATUS_STYLES: Record<string, string> = {
  pending: "text-amber-700 bg-amber-50",
  approved: "text-emerald-700 bg-emerald-50",
  rejected: "text-red-700 bg-red-50",
  cancelled: "text-slate-400 bg-slate-50",
};

export function Badge({ value, styles }: { value: string | null | undefined; styles: Record<string, string> }) {
  if (!value) return null;
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${styles[value] || "text-slate-500 bg-slate-100"}`}>
      {value.replace(/_/g, " ")}
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
