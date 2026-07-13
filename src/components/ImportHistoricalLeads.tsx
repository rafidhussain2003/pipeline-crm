"use client";

import { useEffect, useRef, useState } from "react";

type ImportRange = "7d" | "30d" | "90d" | "180d" | "365d" | "all";

type CurrentImport = {
  id: string;
  status: "running" | "paused" | "completed" | "cancelled" | "failed";
  range: ImportRange;
  totalFound: number;
  totalImported: number;
  totalSkipped: number;
  totalFailed: number;
  currentFormName: string | null;
  formsTotal: number;
  formsCompleted: number;
  estimatedSecondsRemaining: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

type HistoryRow = {
  id: string;
  status: CurrentImport["status"];
  range: ImportRange;
  totalFound: number;
  totalImported: number;
  totalSkipped: number;
  totalFailed: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

const RANGE_LABELS: Record<ImportRange, string> = {
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
  "180d": "Last 180 Days",
  "365d": "Last 365 Days",
  all: "All Available Leads",
};

const STATUS_META: Record<CurrentImport["status"], { label: string; className: string }> = {
  running: { label: "Running", className: "text-blue-700 bg-blue-50" },
  paused: { label: "Paused", className: "text-slate-500 bg-slate-100" },
  completed: { label: "Completed", className: "text-emerald-700 bg-emerald-50" },
  cancelled: { label: "Cancelled", className: "text-slate-500 bg-slate-100" },
  failed: { label: "Failed", className: "text-red-700 bg-red-50" },
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatEta(seconds: number | null): string {
  if (seconds == null) return "Calculating…";
  if (seconds < 60) return `~${seconds}s remaining`;
  const m = Math.round(seconds / 60);
  return `~${m}m remaining`;
}

export default function ImportHistoricalLeads({ sourceId, pageName }: { sourceId: string; pageName: string }) {
  const [range, setRange] = useState<ImportRange>("30d");
  const [current, setCurrent] = useState<CurrentImport | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [startError, setStartError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadCurrent() {
    const res = await fetch(`/api/lead-sources/${sourceId}/import/current`);
    const data = await res.json();
    setCurrent(data.import || null);
    return data.import as CurrentImport | null;
  }

  async function loadHistory() {
    const res = await fetch(`/api/lead-sources/${sourceId}/import/history`);
    const data = await res.json();
    setHistory(data.imports || []);
  }

  useEffect(() => {
    loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  // Polling is one of the two things that actually advances a running
  // import (the other is the server-side cron sweep) — every poll hits
  // GET .../import/current, which nudges the background loop forward.
  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (current?.status === "running") {
      pollRef.current = setTimeout(async () => {
        await loadCurrent();
      }, 3000);
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  async function startImport() {
    setStarting(true);
    setStartError("");
    const res = await fetch(`/api/lead-sources/${sourceId}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range }),
    });
    const data = await res.json();
    setStarting(false);
    if (!res.ok) {
      setStartError(data.error || "Could not start import.");
      return;
    }
    await loadCurrent();
  }

  async function cancelImport() {
    if (!current || !confirm("Cancel this import? Leads already imported stay in your CRM.")) return;
    setCancelling(true);
    await fetch(`/api/lead-sources/${sourceId}/import/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importId: current.id }),
    });
    setCancelling(false);
    await loadCurrent();
  }

  async function toggleHistory() {
    if (!showHistory) await loadHistory();
    setShowHistory((v) => !v);
  }

  const isRunning = current?.status === "running";
  const isFinished = current && !isRunning;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="text-xs font-semibold text-slate-500 mb-2">Import Historical Leads</div>

      {!isRunning && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as ImportRange)}
            className="text-xs rounded-md border border-slate-200 px-2 py-1.5"
          >
            {(Object.keys(RANGE_LABELS) as ImportRange[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            onClick={startImport}
            disabled={starting}
            className="text-[11px] font-medium text-white bg-blue-600 rounded px-2.5 py-1.5 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Import Leads"}
          </button>
        </div>
      )}
      {startError && <p className="text-xs text-red-600 mb-2">{startError}</p>}

      {current && (
        <div className={`text-xs rounded-md p-2.5 mb-2 ${STATUS_META[current.status].className}`}>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-semibold">
              {STATUS_META[current.status].label} — {RANGE_LABELS[current.range]}
            </span>
            {isRunning && (
              <button
                onClick={cancelImport}
                disabled={cancelling}
                className="text-[11px] font-medium text-red-700 bg-white/70 rounded px-2 py-0.5 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel"}
              </button>
            )}
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
            <div>
              <dt className="text-[10px] opacity-70 uppercase tracking-wide">Total Found</dt>
              <dd className="font-medium">{current.totalFound}</dd>
            </div>
            <div>
              <dt className="text-[10px] opacity-70 uppercase tracking-wide">Imported</dt>
              <dd className="font-medium">{current.totalImported}</dd>
            </div>
            <div>
              <dt className="text-[10px] opacity-70 uppercase tracking-wide">Skipped (Duplicates)</dt>
              <dd className="font-medium">{current.totalSkipped}</dd>
            </div>
            <div>
              <dt className="text-[10px] opacity-70 uppercase tracking-wide">Failed</dt>
              <dd className="font-medium">{current.totalFailed}</dd>
            </div>
          </dl>

          {isRunning && (
            <div className="mt-2 pt-2 border-t border-black/5 space-y-0.5">
              <div>
                <span className="opacity-70">Current Page:</span> {pageName}
              </div>
              <div>
                <span className="opacity-70">Current Form:</span> {current.currentFormName || "Starting…"} (
                {current.formsCompleted}/{current.formsTotal} forms)
              </div>
              <div>
                <span className="opacity-70">Estimated Time Remaining:</span> {formatEta(current.estimatedSecondsRemaining)}
              </div>
            </div>
          )}

          {isFinished && current.error && <p className="mt-2 pt-2 border-t border-black/5">{current.error}</p>}
        </div>
      )}

      <button onClick={toggleHistory} className="text-[11px] font-medium text-slate-500 hover:text-slate-700">
        {showHistory ? "Hide import history" : "View import history"}
      </button>

      {showHistory && (
        <div className="mt-2 space-y-1.5">
          {history.length === 0 && <div className="text-xs text-slate-400">No imports yet.</div>}
          {history.map((h) => (
            <div key={h.id} className="bg-slate-50 rounded p-2 text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`font-semibold rounded-full px-1.5 py-0.5 ${STATUS_META[h.status].className}`}>
                {STATUS_META[h.status].label}
              </span>
              <span>{RANGE_LABELS[h.range]}</span>
              <span>Started {new Date(h.startedAt).toLocaleString()}</span>
              {h.completedAt && (
                <span>Duration {formatDuration(new Date(h.completedAt).getTime() - new Date(h.startedAt).getTime())}</span>
              )}
              <span>Found {h.totalFound}</span>
              <span>Imported {h.totalImported}</span>
              <span>Duplicates {h.totalSkipped}</span>
              <span>Failed {h.totalFailed}</span>
              {h.error && <span className="text-red-600">{h.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
