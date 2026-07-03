"use client";

import { useEffect, useState } from "react";

type Settings = {
  autoAssignEnabled: boolean;
  assignmentMode: "round_robin" | "weighted" | "skill_based";
  autoRecycleEnabled: boolean;
  recycleAfterMinutes: number;
};

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

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900">Auto Assignment</div>
            <div className="text-xs text-slate-400 mt-0.5">Automatically assign new leads to agents.</div>
          </div>
          <button
            onClick={() => update({ autoAssignEnabled: !settings.autoAssignEnabled })}
            className={`text-xs font-medium rounded-full px-3 py-1.5 ${
              settings.autoAssignEnabled ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"
            }`}
          >
            {settings.autoAssignEnabled ? "On" : "Off"}
          </button>
        </div>

        {settings.autoAssignEnabled && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-sm font-medium text-slate-900 mb-2">Assignment mode</div>
            <div className="flex gap-2">
              {[
                { id: "round_robin", label: "Round Robin" },
                { id: "weighted", label: "Weighted (Tiers)" },
                { id: "skill_based", label: "Skill Based" },
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => update({ assignmentMode: mode.id as Settings["assignmentMode"] })}
                  className={`text-xs font-medium rounded-md px-3 py-2 border ${
                    settings.assignmentMode === mode.id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {settings.assignmentMode === "round_robin" && "Every active agent gets an equal share of leads."}
              {settings.assignmentMode === "weighted" && "Leads split by tier weight — set weights in Pipeline Settings."}
              {settings.assignmentMode === "skill_based" &&
                "Leads with a required skill only go to agents with that skill; falls back to the full pool if nobody matches."}
            </p>
          </div>
        )}
      </div>

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
        <p className="text-xs text-slate-400 mt-3">
          Auto-recycle runs on a schedule (an external cron job calls <code>/api/cron/recycle-leads</code> — see the
          README for setup) rather than continuously, so changes here take effect on the next scheduled run.
        </p>
      </div>
    </div>
  );
}
