"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/hr/shared";

type Dashboard = {
  totalEmployees: number; activeEmployees: number; inactiveEmployees: number; departments: number;
  newJoiners: number; upcomingBirthdays: number; upcomingAnniversaries: number; onLeave: number;
};

export default function HRDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  useEffect(() => {
    fetch("/api/hr/dashboard").then(async (r) => { if (r.ok) setData(await r.json()); });
  }, []);
  if (!data) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const cards: { label: string; value: number; tone?: string; placeholder?: boolean }[] = [
    { label: "Total employees", value: data.totalEmployees },
    { label: "Active", value: data.activeEmployees, tone: "text-emerald-700" },
    { label: "Inactive", value: data.inactiveEmployees, tone: data.inactiveEmployees > 0 ? "text-slate-500" : undefined },
    { label: "Departments", value: data.departments },
    { label: "New joiners (30d)", value: data.newJoiners, tone: "text-sky-700" },
    { label: "On leave today", value: data.onLeave },
    { label: "Upcoming birthdays", value: data.upcomingBirthdays, placeholder: true },
    { label: "Work anniversaries", value: data.upcomingAnniversaries, placeholder: true },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="HR" subtitle="Your company's people at a glance." action={<Link href="/hr/employees" className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Employees</Link>} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center gap-1">
              {c.label}
              {c.placeholder && <span className="text-[9px] text-slate-300">soon</span>}
            </div>
            <div className={`text-lg font-semibold mt-1 ${c.tone || "text-slate-900"}`}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
