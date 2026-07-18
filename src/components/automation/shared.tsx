"use client";

// Phase 23 — shared Automation UI atoms (indigo accent, consistent with the
// sidebar group).
export const WORKFLOW_STATUS_STYLES: Record<string, string> = {
  draft: "text-slate-600 bg-slate-100",
  published: "text-emerald-700 bg-emerald-50",
  disabled: "text-amber-700 bg-amber-50",
  archived: "text-slate-400 bg-slate-100",
};

export const EXECUTION_STATUS_STYLES: Record<string, string> = {
  success: "text-emerald-700 bg-emerald-50",
  skipped: "text-slate-500 bg-slate-100",
  running: "text-sky-700 bg-sky-50",
  pending: "text-slate-500 bg-slate-100",
  retrying: "text-amber-700 bg-amber-50",
  dead_letter: "text-red-700 bg-red-50",
  failed: "text-red-700 bg-red-50",
};

export function StatusBadge({ status, kind = "workflow" }: { status: string | null | undefined; kind?: "workflow" | "execution" }) {
  if (!status) return null;
  const styles = kind === "execution" ? EXECUTION_STATUS_STYLES : WORKFLOW_STATUS_STYLES;
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${styles[status] || "text-slate-500 bg-slate-100"}`}>
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

export function StatCard({ label, value, tone = "slate" }: { label: string; value: React.ReactNode; tone?: string }) {
  const toneMap: Record<string, string> = {
    slate: "text-slate-900", indigo: "text-indigo-700", emerald: "text-emerald-700", amber: "text-amber-700", red: "text-red-700",
  };
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneMap[tone] || toneMap.slate}`}>{value}</div>
    </div>
  );
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
