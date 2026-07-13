"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type PresenceStatus =
  | "online"
  | "idle"
  | "busy"
  | "break"
  | "offline"
  | "away"
  | "lunch"
  | "wrap_up"
  | "locked"
  | "heartbeat_lost";

type Agent = {
  id: string;
  name: string;
  tier: string | null;
  presenceStatus: PresenceStatus;
  lastHeartbeatAt: string | null;
  locked: boolean;
  assignedToday: number;
  wonToday: number;
  conversionTodayPct: number;
  lastActiveLeadName: string | null;
};

type QueueGroup = "unassigned" | "assigned" | "recycled" | "stale" | "answering_machine" | "callback" | "high_priority";
type QueueCounts = Record<QueueGroup, number>;

type QueueLead = {
  id: string;
  name: string | null;
  phone: string | null;
  disposition: string;
  priority: string;
  recycleCount: number;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: string;
};

type Performance = {
  topCloserToday: { ownerId: string | null; ownerName: string | null; value: number } | null;
  mostActiveToday: { assignedTo: string | null; ownerName: string | null; value: number } | null;
  mostRecycled: { id: string; name: string | null; recycleCount: number; ownerName: string | null }[];
  recentDecisions: { id: string; leadName: string | null; agentName: string | null; ruleUsed: string | null; assignedAt: string }[];
};

const QUEUE_LABELS: Record<QueueGroup, string> = {
  unassigned: "Unassigned",
  assigned: "Assigned",
  recycled: "Recycled",
  stale: "Stale",
  answering_machine: "Answering Machine",
  callback: "Callback",
  high_priority: "High Priority",
};

const STATUS_STYLES: Record<PresenceStatus, string> = {
  online: "text-emerald-700 bg-emerald-50",
  idle: "text-amber-700 bg-amber-50",
  busy: "text-red-700 bg-red-50",
  wrap_up: "text-blue-700 bg-blue-50",
  break: "text-slate-600 bg-slate-100",
  away: "text-slate-600 bg-slate-100",
  lunch: "text-slate-600 bg-slate-100",
  locked: "text-slate-500 bg-slate-100",
  heartbeat_lost: "text-red-600 bg-red-50",
  offline: "text-slate-400 bg-slate-50",
};

const STATUS_LABELS: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Idle",
  busy: "Busy",
  wrap_up: "Wrap Up",
  break: "Break",
  away: "Away",
  lunch: "Lunch",
  locked: "Locked",
  heartbeat_lost: "Heartbeat Lost",
  offline: "Offline",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const POLL_MS = 12_000;

export default function TeamPage() {
  const [tab, setTab] = useState<"presence" | "queue" | "performance">("presence");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<QueueGroup | null>(null);
  const [groupLeads, setGroupLeads] = useState<QueueLead[]>([]);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [autoAssignEnabled, setAutoAssignEnabled] = useState<boolean | null>(null);
  const [assignPicks, setAssignPicks] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");

  const loadAgents = useCallback(async () => {
    const res = await fetch("/api/supervisor/agents");
    if (res.ok) setAgents((await res.json()).agents || []);
  }, []);

  const loadCounts = useCallback(async () => {
    const res = await fetch("/api/supervisor/queue");
    if (res.ok) setCounts((await res.json()).counts || null);
  }, []);

  const loadGroupLeads = useCallback(async (group: QueueGroup) => {
    const res = await fetch(`/api/supervisor/queue?group=${group}`);
    if (res.ok) setGroupLeads((await res.json()).leads || []);
  }, []);

  const loadPerformance = useCallback(async () => {
    const res = await fetch("/api/supervisor/performance");
    if (res.ok) setPerformance(await res.json());
  }, []);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/automation-settings");
    if (res.ok) setAutoAssignEnabled((await res.json()).settings?.autoAssignEnabled ?? null);
  }, []);

  // Settings only need to load once — toggling auto-assign updates local
  // state directly rather than waiting for the next poll.
  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAgents();
    loadCounts();
    loadPerformance();
    const interval = setInterval(() => {
      loadAgents();
      loadCounts();
      loadPerformance();
      if (selectedGroup) loadGroupLeads(selectedGroup);
    }, POLL_MS);
    return () => clearInterval(interval);
    // selectedGroup is read inside the interval closure deliberately via
    // the dependency below, so the poll always refreshes whichever group
    // is currently open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup]);

  function selectGroup(group: QueueGroup) {
    setSelectedGroup(group);
    loadGroupLeads(group);
  }

  async function toggleAutoAssign() {
    if (autoAssignEnabled === null) return;
    const next = !autoAssignEnabled;
    setAutoAssignEnabled(next);
    await fetch("/api/automation-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoAssignEnabled: next }),
    });
  }

  async function toggleLock(agent: Agent) {
    setActionError("");
    const res = await fetch("/api/supervisor/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: agent.id, locked: !agent.locked }),
    });
    if (res.ok) loadAgents();
    else setActionError((await res.json()).error || "Failed to update agent lock.");
  }

  async function forceAssign(leadId: string) {
    const agentId = assignPicks[leadId];
    if (!agentId) return;
    setActionError("");
    const res = await fetch("/api/supervisor/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, agentId }),
    });
    if (res.ok) {
      if (selectedGroup) loadGroupLeads(selectedGroup);
      loadCounts();
      loadAgents();
    } else {
      setActionError((await res.json()).error || "Failed to assign lead.");
    }
  }

  async function forceRecycle(leadId: string) {
    setActionError("");
    const res = await fetch("/api/supervisor/recycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    });
    if (res.ok) {
      if (selectedGroup) loadGroupLeads(selectedGroup);
      loadCounts();
    } else {
      setActionError((await res.json()).error || "Failed to recycle lead.");
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 mb-1">Team</h1>
          <p className="text-sm text-slate-500">Live agent presence, lead queue, and routing controls.</p>
        </div>
        {autoAssignEnabled !== null && (
          <button
            onClick={toggleAutoAssign}
            className={`text-xs font-medium rounded-full px-3 py-1.5 ${
              autoAssignEnabled ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"
            }`}
          >
            Auto-assignment: {autoAssignEnabled ? "Running" : "Paused"}
          </button>
        )}
      </div>

      {actionError && (
        <div className="mb-4 text-sm bg-red-50 border border-red-100 text-red-700 rounded-md px-3 py-2">{actionError}</div>
      )}

      <div className="flex gap-2 mb-5 border-b border-slate-200">
        {(["presence", "queue", "performance"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t === "presence" ? "Presence" : t === "queue" ? "Lead Queue" : "Performance"}
          </button>
        ))}
      </div>

      {tab === "presence" && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Heartbeat</th>
                <th className="px-4 py-3">Last Active Lead</th>
                <th className="px-4 py-3">Assigned Today</th>
                <th className="px-4 py-3">Conversion Today</th>
                <th className="px-4 py-3">Calls Today</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No active agents yet.
                  </td>
                </tr>
              )}
              {agents.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {a.name} <span className="text-xs text-slate-400">Tier {a.tier || "1"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium rounded-full px-2.5 py-1 ${
                        a.locked ? STATUS_STYLES.locked : STATUS_STYLES[a.presenceStatus] ?? STATUS_STYLES.offline
                      }`}
                    >
                      {a.locked ? "Locked" : STATUS_LABELS[a.presenceStatus] ?? a.presenceStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{timeAgo(a.lastHeartbeatAt)}</td>
                  <td className="px-4 py-3 text-slate-700">{a.lastActiveLeadName || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 text-slate-700">{a.assignedToday}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {a.conversionTodayPct}% <span className="text-xs text-slate-400">({a.wonToday}/{a.assignedToday})</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300" title="Telephony not integrated yet">
                    —
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleLock(a)}
                      className={`text-xs font-medium rounded-md px-2.5 py-1 border ${
                        a.locked ? "border-red-200 text-red-700 bg-red-50" : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {a.locked ? "Unlock" : "Lock"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "queue" && (
        <div>
          <div className="grid grid-cols-4 gap-3 mb-5">
            {(Object.keys(QUEUE_LABELS) as QueueGroup[]).map((g) => (
              <button
                key={g}
                onClick={() => selectGroup(g)}
                className={`text-left bg-white border rounded-lg p-3 ${
                  selectedGroup === g ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"
                }`}
              >
                <div className="text-xs font-medium text-slate-500">{QUEUE_LABELS[g]}</div>
                <div className="text-xl font-semibold text-slate-900 mt-1">{counts ? counts[g] : "—"}</div>
              </button>
            ))}
          </div>

          {selectedGroup && (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">
                {QUEUE_LABELS[selectedGroup]} ({groupLeads.length})
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-2">Lead</th>
                    <th className="px-4 py-2">Disposition</th>
                    <th className="px-4 py-2">Owner</th>
                    <th className="px-4 py-2">Recycled</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groupLeads.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        Nothing in this queue right now.
                      </td>
                    </tr>
                  )}
                  {groupLeads.map((l) => (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        <Link href={`/leads/${l.id}`} className="text-blue-700 hover:underline font-medium">
                          {l.name || "—"}
                        </Link>
                        {l.priority === "high" && (
                          <span className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">HIGH</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{l.disposition}</td>
                      <td className="px-4 py-2 text-slate-600">{l.ownerName || <span className="text-slate-400">Unassigned</span>}</td>
                      <td className="px-4 py-2 text-slate-500">{l.recycleCount}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={assignPicks[l.id] || ""}
                            onChange={(e) => setAssignPicks((prev) => ({ ...prev, [l.id]: e.target.value }))}
                            className="text-xs rounded-md border border-slate-200 px-1.5 py-1"
                          >
                            <option value="">Assign to…</option>
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => forceAssign(l.id)}
                            disabled={!assignPicks[l.id]}
                            className="text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-2 py-1 disabled:opacity-40"
                          >
                            Assign
                          </button>
                          <button
                            onClick={() => forceRecycle(l.id)}
                            className="text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-2 py-1"
                          >
                            Recycle
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "performance" && performance && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-medium text-slate-500">Top Closer Today</div>
              <div className="text-lg font-semibold text-slate-900 mt-1">
                {performance.topCloserToday?.ownerName || "—"}{" "}
                {performance.topCloserToday && <span className="text-sm text-slate-400">({performance.topCloserToday.value} won)</span>}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-medium text-slate-500">Most Active Today</div>
              <div className="text-lg font-semibold text-slate-900 mt-1">
                {performance.mostActiveToday?.ownerName || "—"}{" "}
                {performance.mostActiveToday && <span className="text-sm text-slate-400">({performance.mostActiveToday.value} leads)</span>}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Most Recycled Leads</h2>
            {performance.mostRecycled.length === 0 && <p className="text-xs text-slate-400">No recycled leads yet.</p>}
            <div className="space-y-2">
              {performance.mostRecycled.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <Link href={`/leads/${l.id}`} className="text-blue-700 hover:underline">
                    {l.name || "Unnamed lead"}
                  </Link>
                  <span className="text-slate-500">
                    {l.recycleCount}× · {l.ownerName || "Unassigned"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Recent Routing Decisions</h2>
            {performance.recentDecisions.length === 0 && <p className="text-xs text-slate-400">No assignments yet.</p>}
            <div className="space-y-2">
              {performance.recentDecisions.map((d) => (
                <div key={d.id} className="flex items-center justify-between text-sm border-b border-slate-50 pb-2 last:border-0">
                  <div>
                    <span className="font-medium text-slate-800">{d.leadName || "Unnamed lead"}</span>
                    <span className="text-slate-500"> → {d.agentName || "Unassigned"}</span>
                    <span className="text-xs text-slate-400 ml-2">{d.ruleUsed}</span>
                  </div>
                  <span className="text-xs text-slate-400">{new Date(d.assignedAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
