"use client";

import { useEffect, useState } from "react";

type TierName = "1" | "2" | "3" | "senior" | "supervisor";
type Config = {
  enabled: boolean;
  releaseIntervalMinutes: number;
  reservedBacklogPercent: number;
  batchSizePerTier: Record<TierName, number>;
  maxActiveLeads: number | null;
};
type Status = {
  backlog: number;
  waveActive: boolean;
  waveInitialBacklog: number;
  waveReleased: number;
  lastCycleAt: string | null;
  nextReleaseAt: string | null;
};

const INTERVALS = [1, 2, 3, 5, 10];
const TIERS: { key: TierName; label: string }[] = [
  { key: "1", label: "Tier 1" },
  { key: "2", label: "Tier 2" },
  { key: "3", label: "Tier 3" },
  { key: "senior", label: "Senior" },
  { key: "supervisor", label: "Supervisor" },
];

// Phase 17 — Progressive Lead Release settings, shown inside the AI
// Assignment (Automation) page. Toggle at top; everything else only matters
// (and only shows) when it's on.
export default function ProgressiveReleaseSection() {
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/automation-settings/progressive");
    if (!res.ok) return;
    const data = await res.json();
    setConfig(data.config || null);
    setStatus(data.status || null);
  }

  useEffect(() => {
    load();
  }, []);

  async function update(patch: Partial<Config>) {
    if (!config) return;
    const optimistic = { ...config, ...patch, ...(patch.batchSizePerTier ? { batchSizePerTier: { ...config.batchSizePerTier, ...patch.batchSizePerTier } } : {}) };
    setConfig(optimistic);
    setError(null);
    const res = await fetch("/api/automation-settings/progressive", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save.");
      load(); // roll back to server truth
      return;
    }
    const data = await res.json();
    setConfig(data.config);
  }

  if (!config) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-900">Progressive Lead Release</div>
          <div className="text-xs text-slate-400 mt-0.5">
            Release the overnight backlog in small tier-based batches instead of giving the first agents everything.
          </div>
        </div>
        <button
          onClick={() => update({ enabled: !config.enabled })}
          className={`text-xs font-medium rounded-full px-3 py-1.5 ${config.enabled ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"}`}
        >
          {config.enabled ? "On" : "Off"}
        </button>
      </div>

      {!config.enabled && (
        <p className="text-xs text-slate-400 mt-3">
          Off — queued leads are assigned by the standard engine as soon as any agent is available.
        </p>
      )}

      {config.enabled && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          {/* Live wave status */}
          {status && (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>Queued now: <span className="font-semibold text-slate-900">{status.backlog}</span></span>
              {status.waveActive && (
                <span>
                  Current wave: <span className="font-semibold text-slate-900">{status.waveReleased}</span> of{" "}
                  <span className="font-semibold text-slate-900">{status.waveInitialBacklog}</span> released
                </span>
              )}
              {status.nextReleaseAt && new Date(status.nextReleaseAt).getTime() > Date.now() && (
                <span>Next release ≈ {new Date(status.nextReleaseAt).toLocaleTimeString()}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-700">Release every</span>
            <select
              value={config.releaseIntervalMinutes}
              onChange={(e) => update({ releaseIntervalMinutes: Number(e.target.value) })}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            >
              {INTERVALS.map((m) => (
                <option key={m} value={m}>
                  {m} minute{m === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-700">Reserved backlog</span>
              <input
                type="number"
                min={0}
                max={90}
                value={config.reservedBacklogPercent}
                onChange={(e) => update({ reservedBacklogPercent: parseInt(e.target.value || "0", 10) })}
                className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm"
              />
              <span className="text-sm text-slate-700">%</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              This share of the backlog is held back from the first agents online and unlocks as more of the team logs in. 0% releases everything (still batch-paced).
            </p>
          </div>

          <div>
            <div className="text-sm text-slate-700 mb-2">Leads per agent per release, by tier</div>
            <div className="flex flex-wrap gap-3">
              {TIERS.map((t) => (
                <label key={t.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                  {t.label}
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={config.batchSizePerTier[t.key] ?? 1}
                    onChange={(e) => update({ batchSizePerTier: { [t.key]: parseInt(e.target.value || "1", 10) } as Config["batchSizePerTier"] })}
                    className="w-16 rounded-md border border-slate-200 px-2 py-1 text-sm"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-700">Maximum active leads per agent</span>
              <input
                type="number"
                min={1}
                placeholder="No limit"
                value={config.maxActiveLeads ?? ""}
                onChange={(e) => update({ maxActiveLeads: e.target.value ? parseInt(e.target.value, 10) : null })}
                className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
              />
              {config.maxActiveLeads != null && (
                <button onClick={() => update({ maxActiveLeads: null })} className="text-xs font-medium text-slate-500 hover:text-slate-800">
                  Clear
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              An agent at this many open leads is skipped by the release engine until they close something.
            </p>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
