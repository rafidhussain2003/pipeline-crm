"use client";

// Phase 19 — shared finance UI atoms: money formatting, the account selector,
// and the standard page chrome, so all ten finance pages read as one module.
import { useEffect, useState } from "react";

export type UiAccount = {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  subtype: string | null;
  parentId: string | null;
  isSystem: boolean;
  active: boolean;
  description: string | null;
  balanceCents: number;
};

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function moneyNum(v: string | number): string {
  return money(Math.round(Number(v) * 100));
}

export function todayInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One fetch of the chart, shared by every page that needs account pickers.
export function useAccounts() {
  const [accounts, setAccounts] = useState<UiAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = async () => {
    const res = await fetch("/api/finance/accounts");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts || []);
    }
    setLoaded(true);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { accounts, loaded, reload };
}

export function AccountSelect({
  accounts,
  value,
  onChange,
  filter,
  placeholder,
}: {
  accounts: UiAccount[];
  value: string;
  onChange: (id: string) => void;
  filter?: (a: UiAccount) => boolean;
  placeholder?: string;
}) {
  const list = accounts.filter((a) => a.active && (!filter || filter(a)));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
      <option value="" disabled>
        {placeholder || "Select account…"}
      </option>
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} — {a.name}
        </option>
      ))}
    </select>
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

export const JOURNAL_STATUS_STYLES: Record<string, string> = {
  draft: "text-amber-700 bg-amber-50",
  posted: "text-emerald-700 bg-emerald-50",
  voided: "text-red-700 bg-red-50",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${JOURNAL_STATUS_STYLES[status] || "text-slate-500 bg-slate-100"}`}>
      {status}
    </span>
  );
}
