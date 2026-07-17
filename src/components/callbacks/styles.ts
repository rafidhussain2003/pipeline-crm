// Shared status → badge classes, so the dashboard, the lead card and the
// reminder banner never drift apart on what "overdue" looks like.
export const STATUS_STYLES: Record<string, string> = {
  scheduled: "text-slate-600 bg-slate-100",
  due: "text-blue-700 bg-blue-50",
  completed: "text-emerald-700 bg-emerald-50",
  missed: "text-red-700 bg-red-50",
  cancelled: "text-slate-400 bg-slate-50",
  rescheduled: "text-amber-700 bg-amber-50",
};

export const PRIORITY_STYLES: Record<string, string> = {
  urgent: "text-red-700 bg-red-50",
  high: "text-amber-700 bg-amber-50",
  normal: "text-slate-500 bg-slate-100",
  low: "text-slate-400 bg-slate-50",
};

// "in 20 minutes" / "35 minutes overdue" — the agent should never have to
// subtract two timestamps in their head.
export function relativeTime(iso: string, now = Date.now()): string {
  const diffMin = Math.round((new Date(iso).getTime() - now) / 60_000);
  const abs = Math.abs(diffMin);
  const unit = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} hr` : `${Math.round(abs / 1440)} day${Math.round(abs / 1440) === 1 ? "" : "s"}`;
  if (diffMin === 0) return "now";
  return diffMin > 0 ? `in ${unit}` : `${unit} overdue`;
}
