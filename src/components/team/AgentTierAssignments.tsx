"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeLeadStream } from "@/lib/leads/stream-client";

// Enterprise Agent Tier Management — the "Agent Tier Assignments" table on
// the Automation settings page (modeled on the previous CRM's screen).
//
// A tier change saves immediately, optimistically, and updates ONLY the
// affected row — no page reload, no table refetch on the happy path. Other
// open admin screens converge through the "team.updated" realtime signal.
// Managers see the same table read-only (the API tells us which). Agents
// can't reach this data at all — the endpoint 403s, and this component then
// renders nothing.
//
// The dropdown writes users.tier — the exact column every Assignment Engine
// strategy already reads (weighted / tier_based / priority_based / ai). There
// is no separate "engine copy" to sync: the engine loads candidates fresh
// per assignment.

type Agent = {
  id: string;
  name: string | null;
  email: string;
  tier: string;
  presenceStatus: string;
  assignedToday: number;
  autoAssignEnabled: boolean;
  cooldownRemainingSeconds: number;
};

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const TIER_OPTIONS = [
  { value: "1", label: "Tier 1" },
  { value: "2", label: "Tier 2" },
  { value: "3", label: "Tier 3" },
];
// Legacy/extended enum values kept selectable only when an agent already has
// one, so the dropdown never lies about the stored value.
const EXTRA_TIER_LABELS: Record<string, string> = { senior: "Senior", supervisor: "Supervisor" };

function presenceBadge(status: string): { label: string; dot: string; text: string } {
  if (status === "online") return { label: "Online", dot: "bg-emerald-500", text: "text-emerald-700" };
  if (status === "busy" || status === "wrap_up") return { label: "Busy", dot: "bg-amber-500", text: "text-amber-700" };
  if (status === "away" || status === "break" || status === "lunch") return { label: "Away", dot: "bg-amber-400", text: "text-amber-600" };
  if (status === "heartbeat_lost") return { label: "Reconnecting", dot: "bg-slate-400", text: "text-slate-500" };
  return { label: "Offline", dot: "bg-slate-300", text: "text-slate-400" };
}

// showMasterSwitch: render the master Auto Assignment ON/OFF control. Default
// on (the Manager Console's Auto Assignment page); the admin Automation page
// passes false because it already has its own auto-assign toggle.
export default function AgentTierAssignments({ showMasterSwitch = true }: { showMasterSwitch?: boolean } = {}) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [autoAssignEnabled, setAutoAssignEnabled] = useState(true);
  const [cooldownSeconds, setCooldownSeconds] = useState(300);
  const [queueDepth, setQueueDepth] = useState(0);
  const [savingMaster, setSavingMaster] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cooldown countdown, informational only (server timestamps are
  // authoritative, per spec). `fetchedAt` is when the roster was last loaded
  // and `nowTs` advances every second; both live in state so the countdown is
  // a pure function of state during render. Both start at 0 → zero elapsed →
  // the raw server value shows until the first load fills them in.
  const [fetchedAt, setFetchedAt] = useState(0);
  const [nowTs, setNowTs] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/tiers");
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data.agents || []);
      setCanEdit(!!data.viewerCanEdit);
      setAutoAssignEnabled(data.autoAssignEnabled ?? true);
      setCooldownSeconds(data.cooldownSeconds ?? 300);
      setQueueDepth(data.queueDepth ?? 0);
      const t = Date.now();
      setFetchedAt(t);
      setNowTs(t);
    } catch {
      /* transient — the realtime signal or next visit retries */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 1s tick so the cooldown countdown updates; refetch every 20s so the
  // server-authoritative values (and the queue depth) stay fresh.
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    const r = setInterval(() => load(), 20_000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [load]);

  // Toggle the master auto-assignment switch (admin + Lead Distribution Manager).
  async function toggleMaster() {
    if (!canEdit) return;
    const next = !autoAssignEnabled;
    setSavingMaster(true);
    setAutoAssignEnabled(next); // optimistic
    setError("");
    try {
      const res = await fetch("/api/team/auto-assignment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoAssignEnabled: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not change the switch");
    } catch (err) {
      setAutoAssignEnabled(!next); // revert
      setError(err instanceof Error ? err.message : "Could not change auto-assignment");
    } finally {
      setSavingMaster(false);
    }
  }

  // Cooldown remaining for display: the server value minus real elapsed time
  // since the fetch, floored at 0.
  function remainingFor(a: Agent): number {
    if (a.cooldownRemainingSeconds <= 0) return 0;
    const elapsed = Math.floor((nowTs - fetchedAt) / 1000);
    return Math.max(0, a.cooldownRemainingSeconds - elapsed);
  }

  // Realtime: another admin changed a tier (or roster data moved) — refetch,
  // debounced so a burst of changes costs one request.
  useEffect(() => {
    return subscribeLeadStream({
      events: {
        "team.updated": () => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => load(), 500);
        },
      },
    });
  }, [load]);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  async function changeTier(agentId: string, tier: string) {
    const previous = agents?.find((a) => a.id === agentId)?.tier;
    if (previous === undefined || previous === tier) return;
    setError("");
    setSavingId(agentId);
    // Optimistic: only this row's data changes; a failure reverts it.
    setAgents((prev) => (prev ? prev.map((a) => (a.id === agentId ? { ...a, tier } : a)) : prev));
    try {
      const res = await fetch("/api/team/tiers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, tier }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Could not save (HTTP ${res.status})`);
      }
    } catch (err) {
      setAgents((prev) => (prev ? prev.map((a) => (a.id === agentId ? { ...a, tier: previous } : a)) : prev));
      setError(err instanceof Error ? err.message : "Could not save the tier change");
    } finally {
      setSavingId(null);
    }
  }

  // Enable/disable an agent's participation in automatic assignment (writes
  // users.locked server-side — a locked agent is skipped by the assignment
  // roster). Optimistic, per-row, with revert on failure.
  async function toggleAutoAssign(agentId: string, current: boolean) {
    const next = !current;
    setError("");
    setSavingId(agentId);
    setAgents((prev) => (prev ? prev.map((a) => (a.id === agentId ? { ...a, autoAssignEnabled: next } : a)) : prev));
    try {
      const res = await fetch("/api/team/tiers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, autoAssignEnabled: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Could not save (HTTP ${res.status})`);
      }
    } catch (err) {
      setAgents((prev) => (prev ? prev.map((a) => (a.id === agentId ? { ...a, autoAssignEnabled: current } : a)) : prev));
      setError(err instanceof Error ? err.message : "Could not change auto-assign participation");
    } finally {
      setSavingId(null);
    }
  }

  // Agents (or anyone without roster access) see nothing — not an empty table.
  if (forbidden) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      {/* Master Auto Assignment switch — the same company setting the admin
          Automation page controls. When OFF, no automatic assignment happens;
          manual assignment still works. */}
      {showMasterSwitch && (
      <div
        className={`flex items-start justify-between gap-4 mb-4 rounded-lg border p-3 ${
          autoAssignEnabled ? "bg-white border-slate-200" : "bg-amber-50/60 border-amber-200"
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className={`inline-block w-2.5 h-2.5 rounded-full ${autoAssignEnabled ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className={`text-sm font-semibold ${autoAssignEnabled ? "text-emerald-800" : "text-amber-900"}`}>
              {autoAssignEnabled ? "Auto Assignment On" : "Auto Assignment Off"}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {autoAssignEnabled
              ? "New leads route to available agents automatically."
              : "New leads stay unassigned until you assign them manually."}
            {" "}Cooldown: {Math.round(cooldownSeconds / 60)} min · Waiting queue: <span className="font-medium">{queueDepth}</span>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={toggleMaster}
            role="switch"
            aria-checked={autoAssignEnabled}
            aria-label="Auto Assignment"
            disabled={savingMaster}
            className={`shrink-0 text-xs font-semibold rounded-full px-4 py-2 border transition-colors disabled:opacity-50 ${
              autoAssignEnabled
                ? "text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                : "text-amber-900 bg-amber-100 border-amber-300 hover:bg-amber-200"
            }`}
          >
            {autoAssignEnabled ? "ON" : "OFF"}
          </button>
        )}
      </div>
      )}

      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium text-slate-900">Agent Tier Assignments</div>
        {!canEdit && agents !== null && (
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Read only</span>
        )}
      </div>
      <div className="text-xs text-slate-400 mb-3">
        The tier the Assignment Engine uses for every agent (Weighted, Tier Based and Priority Based modes). Changes
        save immediately and apply to the next assignment.
      </div>

      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}

      {agents === null ? (
        <div className="text-sm text-slate-400 py-4">Loading…</div>
      ) : agents.length === 0 ? (
        <div className="text-sm text-slate-400 py-4">No active agents yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                <th className="py-2 pr-4">Agent</th>
                <th className="py-2 pr-4">Tier</th>
                <th className="py-2 pr-4">Online</th>
                <th className="py-2 pr-4">Today</th>
                <th className="py-2 pr-4">Auto Assign</th>
                <th className="py-2">Cooldown</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const badge = presenceBadge(a.presenceStatus);
                const extraLabel = EXTRA_TIER_LABELS[a.tier];
                return (
                  <tr key={a.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-slate-900 truncate max-w-[220px]">{a.name || a.email}</div>
                      <div className="text-xs text-slate-400 truncate max-w-[220px]">{a.email}</div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <select
                        value={a.tier}
                        disabled={!canEdit || savingId === a.id}
                        onChange={(e) => changeTier(a.id, e.target.value)}
                        aria-label={`Tier for ${a.name || a.email}`}
                        className="rounded-md border border-slate-200 px-2 py-1.5 text-sm bg-white text-slate-700 disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {TIER_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                        {extraLabel && <option value={a.tier}>{extraLabel}</option>}
                      </select>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${badge.text}`}>
                        <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700">{a.assignedToday}</td>
                    <td className="py-2.5 pr-4">
                      {/* Enable/disable this agent's participation in automatic
                          assignment. Editable for admins and the Lead
                          Distribution Manager; a read-only indicator otherwise. */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={a.autoAssignEnabled}
                        aria-label={`Auto-assign participation for ${a.name || a.email}`}
                        disabled={!canEdit || savingId === a.id}
                        onClick={() => toggleAutoAssign(a.id, a.autoAssignEnabled)}
                        title={
                          a.autoAssignEnabled
                            ? "Receiving automatic assignments — click to pause"
                            : "Paused — excluded from automatic assignment; click to resume"
                        }
                        className={`inline-block w-8 rounded-full relative transition-colors align-middle ${
                          a.autoAssignEnabled ? "bg-emerald-500" : "bg-slate-300"
                        } ${canEdit ? "cursor-pointer" : "cursor-default"} disabled:opacity-60`}
                        style={{ height: "18px" }}
                      >
                        <span
                          className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all"
                          style={{ left: a.autoAssignEnabled ? "16px" : "2px" }}
                        />
                      </button>
                    </td>
                    <td className="py-2.5">
                      {/* Server-computed cooldown, counted down client-side for
                          display only. Ready = eligible for the next auto lead. */}
                      {(() => {
                        const rem = remainingFor(a);
                        return rem > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            {mmss(rem)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            Ready
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
