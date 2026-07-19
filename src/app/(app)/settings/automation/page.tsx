"use client";

import { useEffect, useState } from "react";
import ProgressiveReleaseSection from "@/components/automation/ProgressiveReleaseSection";

type AssignmentMode =
  | "round_robin"
  | "weighted"
  | "skill_based"
  | "tier_based"
  | "priority_based"
  | "last_assigned"
  | "least_active"
  | "most_available"
  | "random"
  | "ai";

type Settings = {
  autoAssignEnabled: boolean;
  assignmentMode: AssignmentMode;
  autoRecycleEnabled: boolean;
  recycleAfterMinutes: number;
  heartbeatTimeoutSeconds: number;
  workingHoursStart: number | null;
  workingHoursEnd: number | null;
  maxOpenLeadsPerAgent: number | null;
  maxRecycleCount: number;
};

const ASSIGNMENT_MODES: { id: AssignmentMode; label: string; description: string }[] = [
  { id: "round_robin", label: "Round Robin", description: "Every available agent gets an equal share of leads, in turn." },
  { id: "weighted", label: "Weighted (Tiers)", description: "Leads split by tier weight — set weights in Pipeline Settings." },
  { id: "skill_based", label: "Skill Based", description: "Leads with a required skill only go to agents with that skill; falls back to the full pool if nobody matches." },
  { id: "tier_based", label: "Tier Based", description: "Always routes to the highest tier that has an available agent; rotates equally within it." },
  { id: "priority_based", label: "Priority Based", description: "High-priority leads go to your top tier; everyone else uses weighted rotation." },
  { id: "last_assigned", label: "Last Assigned", description: "Sticky — keeps sending to the agent who got the previous lead while they stay available (burst affinity)." },
  { id: "least_active", label: "Least Active", description: "Routes to whoever currently has the fewest open leads." },
  { id: "most_available", label: "Most Available", description: "Routes to whoever has been idle longest (waiting most for a lead)." },
  { id: "random", label: "Random", description: "Picks a random available agent each time." },
  { id: "ai", label: "AI (Adaptive)", description: "Balances idle time, current workload, and tier automatically to pick the best agent." },
];

function minutesToTimeInput(minutes: number | null): string {
  if (minutes == null) return "";
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeInputToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export default function AutomationPage() {
  const [settings, setSettings] = useState<Settings | null>(null);

  async function load() {
    const res = await fetch("/api/automation-settings");
    const data = await res.json();
    setSettings(data.settings || null);
  }

  useEffect(() => {
    load();
  }, []);

  async function update(patch: Partial<Settings>) {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    await fetch("/api/automation-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  if (!settings) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Automation</h1>
        <p className="text-sm text-slate-500">Control how leads get assigned and recycled.</p>
      </div>

      {/* Auto Assignment is the one control here with immediate, company-wide
          consequences, so its CURRENT STATE is stated in words rather than left
          to be inferred from a small pill — "paused" is easy to miss, and the
          cost of missing it is leads silently piling up unassigned. */}
      <div
        className={`border rounded-lg p-4 ${
          settings.autoAssignEnabled ? "bg-white border-slate-200" : "bg-amber-50/60 border-amber-200"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  settings.autoAssignEnabled ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span
                role="status"
                className={`text-sm font-semibold ${
                  settings.autoAssignEnabled ? "text-emerald-800" : "text-amber-900"
                }`}
              >
                {settings.autoAssignEnabled ? "Auto Assignment Enabled" : "Auto Assignment Paused"}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1.5">
              {settings.autoAssignEnabled
                ? "New leads are routed to an available agent automatically."
                : "New leads still arrive in the CRM — they stay unassigned until you turn this back on. Existing assignments are unaffected."}
            </div>
          </div>
          <button
            onClick={() => update({ autoAssignEnabled: !settings.autoAssignEnabled })}
            role="switch"
            aria-checked={settings.autoAssignEnabled}
            aria-label="Auto Assignment"
            className={`shrink-0 text-xs font-semibold rounded-full px-4 py-2 border transition-colors ${
              settings.autoAssignEnabled
                ? "text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                : "text-amber-900 bg-amber-100 border-amber-300 hover:bg-amber-200"
            }`}
          >
            {settings.autoAssignEnabled ? "ON" : "OFF"}
          </button>
        </div>

        {settings.autoAssignEnabled && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-sm font-medium text-slate-900 mb-2">Assignment mode</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ASSIGNMENT_MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => update({ assignmentMode: mode.id })}
                  className={`text-xs font-medium rounded-md px-3 py-2 border text-left ${
                    settings.assignmentMode === mode.id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {ASSIGNMENT_MODES.find((m) => m.id === settings.assignmentMode)?.description}
            </p>
          </div>
        )}
      </div>

      {/* Phase 17 — Progressive Lead Release (only meaningful when auto
          assignment is on; the engine itself also honors the master toggle). */}
      <ProgressiveReleaseSection />

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900">Auto Recycle</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Reassign stale &quot;New Lead&quot; leads to a different agent after a period of inactivity.
            </div>
          </div>
          <button
            onClick={() => update({ autoRecycleEnabled: !settings.autoRecycleEnabled })}
            className={`text-xs font-medium rounded-full px-3 py-1.5 ${
              settings.autoRecycleEnabled ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"
            }`}
          >
            {settings.autoRecycleEnabled ? "On" : "Off"}
          </button>
        </div>
        {settings.autoRecycleEnabled && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2">
            <span className="text-sm text-slate-700">Recycle after</span>
            <input
              type="number"
              min={5}
              value={settings.recycleAfterMinutes}
              onChange={(e) => update({ recycleAfterMinutes: parseInt(e.target.value || "0", 10) })}
              className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
            <span className="text-sm text-slate-700">minutes of inactivity</span>
          </div>
        )}
        {settings.autoRecycleEnabled && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-slate-700">Stop recycling a lead after</span>
            <input
              type="number"
              min={1}
              value={settings.maxRecycleCount}
              onChange={(e) => update({ maxRecycleCount: parseInt(e.target.value || "0", 10) })}
              className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
            <span className="text-sm text-slate-700">times (then leave it for a human to review)</span>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-3">
          Auto-recycle runs on a schedule (an external cron job calls <code>/api/cron/recycle-leads</code> — see the
          README for setup) rather than continuously, so changes here take effect on the next scheduled run.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="text-sm font-medium text-slate-900 mb-1">Working Hours</div>
        <div className="text-xs text-slate-400 mb-3">
          Restrict auto-assignment to a window of the day. Leave both blank to assign around the clock (default).
        </div>
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={minutesToTimeInput(settings.workingHoursStart)}
            onChange={(e) => update({ workingHoursStart: timeInputToMinutes(e.target.value) })}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
          <span className="text-sm text-slate-500">to</span>
          <input
            type="time"
            value={minutesToTimeInput(settings.workingHoursEnd)}
            onChange={(e) => update({ workingHoursEnd: timeInputToMinutes(e.target.value) })}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
          {(settings.workingHoursStart != null || settings.workingHoursEnd != null) && (
            <button
              onClick={() => update({ workingHoursStart: null, workingHoursEnd: null })}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-2">
          An end time earlier than the start time is treated as an overnight window (e.g. 10pm–6am).
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="text-sm font-medium text-slate-900 mb-1">Agent Availability &amp; Workload</div>
        <div className="text-xs text-slate-400 mb-3">
          Controls how quickly an unresponsive agent is skipped, and how many open leads one agent can be assigned at once.
        </div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-slate-700">Treat an agent as unavailable after</span>
          <input
            type="number"
            min={30}
            value={settings.heartbeatTimeoutSeconds}
            onChange={(e) => update({ heartbeatTimeoutSeconds: parseInt(e.target.value || "0", 10) })}
            className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
          <span className="text-sm text-slate-700">seconds without a heartbeat</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-700">Max open leads per agent</span>
          <input
            type="number"
            min={1}
            placeholder="No limit"
            value={settings.maxOpenLeadsPerAgent ?? ""}
            onChange={(e) => update({ maxOpenLeadsPerAgent: e.target.value ? parseInt(e.target.value, 10) : null })}
            className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
          {settings.maxOpenLeadsPerAgent != null && (
            <button onClick={() => update({ maxOpenLeadsPerAgent: null })} className="text-xs font-medium text-slate-500 hover:text-slate-800">
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Leads marked &quot;High Priority&quot; on the lead detail page bypass this cap rather than wait for a less-loaded agent.
        </p>
      </div>
    </div>
  );
}
