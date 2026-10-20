"use client";

// Lending Bank — small shared UI bits (INR formatting, dates, badges).
export const inr = (cents: number) => `${cents < 0 ? "-" : ""}₹${(Math.abs(cents) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
};
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function LoanStatusBadge({ status, overdue }: { status: string; overdue?: number }) {
  if (status === "active" && overdue) return <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-red-700 bg-red-50">{overdue} overdue</span>;
  const cls = status === "active" ? "text-emerald-700 bg-emerald-50" : status === "closed" ? "text-slate-600 bg-slate-100" : "text-amber-700 bg-amber-50";
  return <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${cls}`}>{status === "closed" ? "Repaid" : status}</span>;
}

export const inputCls = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm";
export const labelCls = "block text-xs font-semibold text-slate-600 mb-1";
