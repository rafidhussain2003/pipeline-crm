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
};

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

export default function AgentTierAssignments() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    } catch {
      /* transient — the realtime signal or next visit retries */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  // Agents (or anyone without roster access) see nothing — not an empty table.
  if (forbidden) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
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
                <th className="py-2">Status</th>
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
                      {/* Read-only mirror of the Lock control on the Team
                          dashboard — a locked agent is excluded from
                          automatic assignment. */}
                      <span
                        title={
                          a.autoAssignEnabled
                            ? "Receiving automatic assignments"
                            : "Locked — excluded from automatic assignment (manage on the Team page)"
                        }
                        className={`inline-block w-8 rounded-full relative transition-colors ${
                          a.autoAssignEnabled ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        style={{ height: "18px" }}
                      >
                        <span
                          className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all"
                          style={{ left: a.autoAssignEnabled ? "16px" : "2px" }}
                        />
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span className="inline-block text-xs font-medium text-slate-600 bg-slate-100 rounded px-2 py-0.5">
                        Active
                      </span>
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
