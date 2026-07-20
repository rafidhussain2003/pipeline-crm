"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// My Tasks (Follow-up & Pipeline Part 4) — the agent's marching orders for
// the day: overdue callbacks first, then today's, newly assigned leads and
// high-priority follow-ups. Admins additionally get the company pipeline
// overview (Part 5) on the same page. Everything links straight into the
// Lead Workspace.

type TaskCallback = {
  id: string;
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  scheduledAt: string;
  reason: string;
  priority: string;
  status: string;
};

type TaskLead = {
  id: string;
  name: string | null;
  phone: string | null;
  disposition: string;
  priority?: string;
  followUpAt?: string | null;
  createdAt?: string;
};

type MyTasks = {
  todayCallbacks: TaskCallback[];
  overdueCallbacks: TaskCallback[];
  newLeads: TaskLead[];
  highPriority: TaskLead[];
};

type Overview = {
  leadsRequiringCallbacks: number;
  overdueCallbacks: number;
  overdueFollowUps: number;
  salesClosedToday: number;
  backlog: { ownerId: string; ownerName: string | null; openLeads: number }[];
  overdueCallbackList: {
    id: string;
    leadId: string;
    leadName: string | null;
    agentName: string | null;
    scheduledAt: string;
    priority: string;
    reason: string;
  }[];
};

export default function MyTasksPage() {
  const [tasks, setTasks] = useState<MyTasks | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/my");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load your tasks");
      setTasks(await res.json());
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load your tasks");
    }
    // Admin overview: a 403 simply means "not a supervisor" — no section.
    try {
      const res = await fetch("/api/pipeline/overview");
      if (res.ok) setOverview(await res.json());
    } catch {
      /* section stays hidden */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime (Part 7): assignment and lead-change signals re-run the load —
  // debounced, silent. Same stream the leads pages already use.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const schedule = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => loadRef.current(), 600);
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/leads/stream");
      es.addEventListener("ready", () => {
        attempt = 0;
      });
      es.addEventListener("lead.assigned", schedule);
      es.addEventListener("lead.updated", schedule);
      es.onerror = () => {
        es?.close();
        es = null;
        if (stopped) return;
        attempt += 1;
        retry = setTimeout(connect, Math.min(1000 * 2 ** (attempt - 1), 30_000));
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      es?.close();
    };
  }, []);

  const callbackRow = (c: TaskCallback, overdue: boolean) => (
    <Link
      key={c.id}
      href={`/leads/${c.leadId}`}
      className="flex items-center justify-between gap-3 rounded-md border border-slate-100 hover:border-slate-200 hover:bg-slate-50 px-3 py-2"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900 truncate">{c.leadName || "Unknown"}</span>
        <span className="block text-xs text-slate-500 truncate">
          {c.reason} · {c.leadPhone || "no phone"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block text-xs font-medium ${overdue ? "text-red-600" : "text-slate-700"}`}>
          {new Date(c.scheduledAt).toLocaleString()}
        </span>
        {c.priority !== "normal" && <span className="block text-[10px] text-slate-400 capitalize">{c.priority}</span>}
      </span>
    </Link>
  );

  const leadRow = (l: TaskLead) => (
    <Link
      key={l.id}
      href={`/leads/${l.id}`}
      className="flex items-center justify-between gap-3 rounded-md border border-slate-100 hover:border-slate-200 hover:bg-slate-50 px-3 py-2"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900 truncate">{l.name || "Unknown"}</span>
        <span className="block text-xs text-slate-500 truncate">
          {l.disposition} · {l.phone || "no phone"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {l.followUpAt && <span className="block text-xs text-slate-700">{new Date(l.followUpAt).toLocaleString()}</span>}
        {l.priority === "high" && <span className="block text-[10px] font-semibold text-amber-700">HIGH</span>}
      </span>
    </Link>
  );

  const section = (title: string, count: number, accent: string, children: React.ReactNode) => (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        {title}
        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${accent}`}>{count}</span>
      </h2>
      {children}
    </div>
  );

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">My Tasks</h1>
        <p className="text-sm text-slate-500 mt-1">What needs your attention today.</p>
      </div>

      {loadError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          <span>{loadError}</span>
          <button onClick={() => load()} className="shrink-0 text-xs font-semibold text-red-800 bg-red-100 hover:bg-red-200 rounded px-2.5 py-1">
            Retry
          </button>
        </div>
      )}

      {!tasks && !loadError && <div className="text-sm text-slate-400">Loading…</div>}

      {tasks && (
        <div className="grid gap-6 md:grid-cols-2">
          {section(
            "Overdue Callbacks",
            tasks.overdueCallbacks.length,
            "text-red-700 bg-red-50",
            <div className="space-y-2">
              {tasks.overdueCallbacks.map((c) => callbackRow(c, true))}
              {tasks.overdueCallbacks.length === 0 && <p className="text-xs text-slate-400">Nothing overdue. 👏</p>}
            </div>
          )}
          {section(
            "Today's Callbacks",
            tasks.todayCallbacks.length,
            "text-amber-700 bg-amber-50",
            <div className="space-y-2">
              {tasks.todayCallbacks.map((c) => callbackRow(c, false))}
              {tasks.todayCallbacks.length === 0 && <p className="text-xs text-slate-400">No callbacks scheduled for today.</p>}
            </div>
          )}
          {section(
            "New Assigned Leads",
            tasks.newLeads.length,
            "text-blue-700 bg-blue-50",
            <div className="space-y-2">
              {tasks.newLeads.map(leadRow)}
              {tasks.newLeads.length === 0 && <p className="text-xs text-slate-400">No untouched new leads.</p>}
            </div>
          )}
          {section(
            "High Priority Follow-ups",
            tasks.highPriority.length,
            "text-purple-700 bg-purple-50",
            <div className="space-y-2">
              {tasks.highPriority.map(leadRow)}
              {tasks.highPriority.length === 0 && <p className="text-xs text-slate-400">No high-priority follow-ups pending.</p>}
            </div>
          )}
        </div>
      )}

      {/* Admin pipeline overview (Part 5) — present only when the overview
          endpoint authorized this user. */}
      {overview && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Pipeline Overview</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              ["Leads requiring callbacks", overview.leadsRequiringCallbacks, "text-slate-900"],
              ["Overdue callbacks", overview.overdueCallbacks, overview.overdueCallbacks > 0 ? "text-red-600" : "text-slate-900"],
              ["Overdue follow-ups", overview.overdueFollowUps, overview.overdueFollowUps > 0 ? "text-amber-600" : "text-slate-900"],
              ["Sales closed today", overview.salesClosedToday, "text-emerald-600"],
            ].map(([label, value, cls]) => (
              <div key={String(label)} className="bg-white border border-slate-200 rounded-lg p-4">
                <div className={`text-2xl font-semibold ${cls}`}>{Number(value).toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-1">{label}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Most Overdue Callbacks</h3>
              <div className="space-y-2">
                {overview.overdueCallbackList.map((c) => (
                  <Link
                    key={c.id}
                    href={`/leads/${c.leadId}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-100 hover:bg-slate-50 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900 truncate">{c.leadName || "Unknown"}</span>
                      <span className="block text-xs text-slate-500 truncate">
                        {c.agentName || "Unassigned"} · {c.reason}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-red-600">{new Date(c.scheduledAt).toLocaleString()}</span>
                  </Link>
                ))}
                {overview.overdueCallbackList.length === 0 && <p className="text-xs text-slate-400">No overdue callbacks. 👏</p>}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Agents With Highest Backlog</h3>
              <div className="space-y-2">
                {overview.backlog.map((b) => (
                  <div key={b.ownerId} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
                    <span className="text-sm font-medium text-slate-900 truncate">{b.ownerName || "Unknown"}</span>
                    <span className="text-sm font-semibold text-slate-700">{b.openLeads.toLocaleString()} open</span>
                  </div>
                ))}
                {overview.backlog.length === 0 && <p className="text-xs text-slate-400">No open leads assigned.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
