"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/attendance/shared";

// Phase 20 — reports are PLACEHOLDERS only (architecture registered in
// lib/attendance; implementations are a future phase).
export default function AttendanceReportsPage() {
  const [reports, setReports] = useState<{ key: string; label: string }[]>([]);

  useEffect(() => {
    fetch("/api/attendance/settings").then(async (r) => {
      if (r.ok) setReports((await r.json()).reports || []);
    });
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Reports" subtitle="Attendance reporting is coming in a future update." />
      <div className="grid sm:grid-cols-2 gap-3">
        {reports.map((r) => (
          <div key={r.key} className="bg-white border border-slate-200 rounded-lg p-5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">{r.label}</span>
            <span className="text-[10px] font-semibold uppercase text-slate-400">Coming soon</span>
          </div>
        ))}
      </div>
    </div>
  );
}
