"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, StatCard, StatusBadge, relTime } from "@/components/automation/shared";

type Dashboard = {
  totalWorkflows: number;
  byStatus: Record<string, number>;
  executions7d: number;
  successRate: number | null;
  deadLetter: number;
  recent: { id: string; workflowName: string | null; triggerLabel: string; status: string; durationMs: number | null; createdAt: string }[];
};

export default function AutomationDashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => { fetch("/api/automation/dashboard").then(async (r) => { if (r.ok) setD((await r.json()).dashboard); }); }, []);

  if (!d) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Automation" subtitle="Your company's workflow automation at a glance." action={<Link href="/automation/workflows" className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md">Manage workflows</Link>} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Workflows" value={d.totalWorkflows} tone="indigo" />
        <StatCard label="Published" value={d.byStatus.published ?? 0} tone="emerald" />
        <StatCard label="Runs (7d)" value={d.executions7d} />
        <StatCard label="Success rate" value={d.successRate == null ? "—" : `${d.successRate}%`} tone={d.successRate != null && d.successRate < 80 ? "amber" : "emerald"} />
      </div>

      {d.deadLetter > 0 && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {d.deadLetter} execution(s) in the dead-letter queue (retries exhausted). Review them in <Link href="/automation/executions?status=dead_letter" className="underline">Execution History</Link>.
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-700 mb-2">Recent executions</h2>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {d.recent.map((e) => (
          <Link key={e.id} href={`/automation/executions?focus=${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
            <StatusBadge status={e.status} kind="execution" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{e.workflowName || "—"}</div>
              <div className="text-xs text-slate-400">{e.triggerLabel}</div>
            </div>
            <div className="text-xs text-slate-400 shrink-0">{e.durationMs != null ? `${e.durationMs}ms · ` : ""}{relTime(e.createdAt)}</div>
          </Link>
        ))}
        {d.recent.length === 0 && <p className="text-sm text-slate-400 px-4 py-8 text-center">No executions yet. Publish a workflow and trigger it to see runs here.</p>}
      </div>
    </div>
  );
}
