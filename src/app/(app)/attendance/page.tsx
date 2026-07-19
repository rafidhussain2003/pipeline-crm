"use client";

import Link from "next/link";
import { useLoadedData, LoadingPane, LoadErrorPane } from "@/components/LoadState";
import { fmtMinutes, PageHeader } from "@/components/attendance/shared";

type Dashboard = {
  totalEmployees: number; present: number; absent: number; late: number; onLeave: number;
  checkedIn: number; checkedOut: number; currentlyWorking: number; onBreak: number;
  avgWorkedMinutes: number; todayIsHoliday: boolean; workDate: string;
  upcomingHolidays: { name: string; date: string; kind: string }[];
  pendingLeaveRequests: number;
};

export default function AttendanceDashboardPage() {
  const { data, loading, error, reload } = useLoadedData<Dashboard>("/api/attendance/dashboard", (b) => b as Dashboard);

  if (loading) return <LoadingPane />;
  if (error || !data) return <LoadErrorPane message={error || "No data was returned."} onRetry={reload} />;

  const cards: { label: string; value: string | number; tone?: string }[] = [
    { label: "Employees", value: data.totalEmployees },
    { label: "Present", value: data.present, tone: "text-emerald-700" },
    { label: "Absent", value: data.absent, tone: data.absent > 0 ? "text-red-600" : undefined },
    { label: "Late", value: data.late, tone: data.late > 0 ? "text-amber-600" : undefined },
    { label: "On leave", value: data.onLeave },
    { label: "Checked in", value: data.checkedIn },
    { label: "Checked out", value: data.checkedOut },
    { label: "Working now", value: data.currentlyWorking, tone: "text-sky-700" },
    { label: "On break", value: data.onBreak },
    { label: "Avg hours (month)", value: fmtMinutes(data.avgWorkedMinutes) },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Attendance" subtitle={`Live picture for ${data.workDate}${data.todayIsHoliday ? " — today is a holiday" : ""}.`} />

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</div>
            <div className={`text-lg font-semibold mt-1 ${c.tone || "text-slate-900"}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5 mt-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Upcoming holidays</h2>
            <Link href="/attendance/holidays" className="text-xs font-medium text-blue-600">Manage</Link>
          </div>
          <div className="space-y-2">
            {data.upcomingHolidays.map((h) => (
              <div key={`${h.date}-${h.name}`} className="flex items-center justify-between text-sm">
                <span className="text-slate-800">{h.name}</span>
                <span className="text-slate-400 text-xs">{h.date}</span>
              </div>
            ))}
            {data.upcomingHolidays.length === 0 && <p className="text-xs text-slate-400">No upcoming holidays configured.</p>}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Leave requests</h2>
            <Link href="/attendance/leave" className="text-xs font-medium text-blue-600">Review</Link>
          </div>
          {data.pendingLeaveRequests > 0 ? (
            <p className="text-sm text-slate-800">
              <span className="font-semibold text-amber-600">{data.pendingLeaveRequests}</span> pending request{data.pendingLeaveRequests === 1 ? "" : "s"} waiting for a decision.
            </p>
          ) : (
            <p className="text-xs text-slate-400">No pending leave requests.</p>
          )}
        </div>
      </div>
    </div>
  );
}
