"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ── types mirrored from src/lib/operations ────────────────────────────────
type PresenceState = "ONLINE" | "OFFLINE" | "AWAY" | "BUSY" | "LOCKED" | "LOGGED_OUT" | "UNKNOWN";
type SystemStatus = "Healthy" | "Busy" | "High Load" | "Critical";
type OpsAgent = {
  userId: string; name: string; state: PresenceState; activeLeads: number;
  assignmentsToday: number; idleSeconds: number | null; capacity: number | null; lastHeartbeatAt: string | null;
};
type OpsWarning = { level: "critical" | "warning" | "info"; title: string; detail: string };
type OpsSnapshot = {
  at: string;
  liveStatus: { online: number; busy: number; away: number; offline: number; locked: number; unknown: number; total: number };
  queue: { size: number; oldestWaitSeconds: number | null; avgWaitSeconds: number | null; avgAssignmentTimeMs: number | null; status: SystemStatus };
  today: { leadsReceived: number; assignments: number; recycled: number; closed: number; openLeads: number; avgResponseSeconds: number | null; avgQueueSeconds: number | null };
  agents: OpsAgent[];
  warnings: OpsWarning[];
};
type ActivityItem = { id: string; type: string; label: string; agentId?: string | null; leadId?: string | null; at: string };

// ── small helpers ──────────────────────────────────────────────────────────
function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function dur(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
const STATE_STYLE: Record<PresenceState, { dot: string; label: string; text: string }> = {
  ONLINE: { dot: "bg-emerald-500", label: "Online", text: "text-emerald-700" },
  BUSY: { dot: "bg-amber-500", label: "Busy", text: "text-amber-700" },
  AWAY: { dot: "bg-orange-400", label: "Away", text: "text-orange-600" },
  LOCKED: { dot: "bg-slate-400", label: "Locked", text: "text-slate-500" },
  UNKNOWN: { dot: "bg-slate-300", label: "Unknown", text: "text-slate-400" },
  OFFLINE: { dot: "bg-slate-300", label: "Offline", text: "text-slate-400" },
  LOGGED_OUT: { dot: "bg-slate-300", label: "Offline", text: "text-slate-400" },
};
const STATUS_STYLE: Record<SystemStatus, string> = {
  Healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Busy: "bg-sky-50 text-sky-700 border-sky-200",
  "High Load": "bg-amber-50 text-amber-700 border-amber-200",
  Critical: "bg-red-50 text-red-700 border-red-200",
};

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function OperationsPage() {
  const [snap, setSnap] = useState<OpsSnapshot | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [denied, setDenied] = useState(false);
  // Seeded in the clock effect below, not here: Date.now() during render is
  // impure (the project's lint rule flags it) and differs between the server
  // and client render, which is a hydration mismatch waiting to happen.
  const [now, setNow] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // one SSE connection — the client never polls
    const es = new EventSource("/api/operations/stream");
    esRef.current = es;
    es.addEventListener("snapshot", (e) => { setSnap(JSON.parse((e as MessageEvent).data)); setConnected(true); });
    es.addEventListener("activity", (e) => {
      const item = JSON.parse((e as MessageEvent).data) as ActivityItem;
      setActivity((prev) => [item, ...prev].slice(0, 100));
    });
    es.addEventListener("activity_batch", (e) => setActivity(JSON.parse((e as MessageEvent).data)));
    es.onerror = () => {
      setConnected(false);
      // a 403 closes the connection immediately with readyState CLOSED
      if (es.readyState === EventSource.CLOSED) setDenied(true);
    };
    return () => es.close();
  }, []);

  // local clock for relative times (no server round-trip)
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nameById = useMemo(() => new Map((snap?.agents ?? []).map((a) => [a.userId, a.name])), [snap]);
  const resolve = (item: ActivityItem) => (item.agentId ? nameById.get(item.agentId) : null);

  if (denied) return <div className="p-6 text-sm text-slate-500">You don’t have access to the Operations Center.</div>;

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Operations Center</h1>
          <p className="text-sm text-slate-500">What’s happening right now.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-xs ${connected ? "text-emerald-600" : "text-slate-400"}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}`} /> {connected ? "Live" : "Connecting…"}
          </span>
          {snap && <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_STYLE[snap.queue.status]}`}>{snap.queue.status}</span>}
        </div>
      </div>

      {!snap ? (
        <div className="text-sm text-slate-400">Loading operational status…</div>
      ) : (
        <div className="space-y-6">
          {/* Warnings — surfaced first when present */}
          {snap.warnings.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {snap.warnings.map((w, i) => (
                <div key={i} className={`rounded-lg border p-3 ${w.level === "critical" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                  <div className={`text-sm font-medium ${w.level === "critical" ? "text-red-800" : "text-amber-800"}`}>⚠ {w.title}</div>
                  <div className={`text-xs mt-0.5 ${w.level === "critical" ? "text-red-600" : "text-amber-700"}`}>{w.detail}</div>
                </div>
              ))}
            </div>
          )}

          {/* Live status */}
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Live status</h2>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
              <Stat label="Online" value={snap.liveStatus.online} />
              <Stat label="Busy" value={snap.liveStatus.busy} />
              <Stat label="Away" value={snap.liveStatus.away} />
              <Stat label="Offline" value={snap.liveStatus.offline + snap.liveStatus.locked + snap.liveStatus.unknown} />
              <Stat label="Queue" value={snap.queue.size} sub={snap.queue.oldestWaitSeconds ? `oldest ${dur(snap.queue.oldestWaitSeconds)}` : undefined} />
              <Stat label="Leads today" value={snap.today.leadsReceived} />
              <Stat label="Assigned today" value={snap.today.assignments} sub={snap.queue.avgAssignmentTimeMs != null ? `~${snap.queue.avgAssignmentTimeMs}ms` : undefined} />
            </div>
          </div>

          {/* Today summary */}
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Today</h2>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Recycled" value={snap.today.recycled} />
              <Stat label="Closed" value={snap.today.closed} />
              <Stat label="Open leads" value={snap.today.openLeads} />
              <Stat label="Avg response" value={dur(snap.today.avgResponseSeconds)} />
              <Stat label="Avg queue wait" value={dur(snap.today.avgQueueSeconds)} />
              <Stat label="Agents" value={snap.liveStatus.total} />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            {/* Agent status */}
            <div className="lg:col-span-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Agents</h2>
              <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Agent</th>
                      <th className="text-left font-medium px-3 py-2">Status</th>
                      <th className="text-right font-medium px-3 py-2">Active</th>
                      <th className="text-right font-medium px-3 py-2">Today</th>
                      <th className="text-right font-medium px-3 py-2">Idle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {snap.agents.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-slate-400 text-center">No agents.</td></tr>}
                    {snap.agents.map((a) => {
                      const st = STATE_STYLE[a.state];
                      return (
                        <tr key={a.userId}>
                          <td className="px-3 py-2 font-medium text-slate-800">{a.name}</td>
                          <td className="px-3 py-2"><span className={`inline-flex items-center gap-1.5 text-xs ${st.text}`}><span className={`w-2 h-2 rounded-full ${st.dot}`} />{st.label}</span></td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{a.activeLeads}{a.capacity != null && <span className="text-slate-300">/{a.capacity}</span>}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{a.assignmentsToday}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-400">{dur(a.idleSeconds)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Live activity feed */}
            <div className="lg:col-span-2">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Live activity</h2>
              <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
                {activity.length === 0 && <div className="px-3 py-4 text-slate-400 text-sm text-center">Waiting for activity…</div>}
                {activity.map((item) => {
                  const who = resolve(item);
                  return (
                    <div key={item.id} className="px-3 py-2 flex items-start justify-between gap-3">
                      <div className="text-sm text-slate-700">
                        {item.label}
                        {who && <span className="text-slate-400"> — {who}</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 whitespace-nowrap mt-0.5">{ago(item.at, now)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
