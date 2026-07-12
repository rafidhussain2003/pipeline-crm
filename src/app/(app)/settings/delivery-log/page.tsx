"use client";

import { useEffect, useState } from "react";

type Log = {
  id: string;
  status: "success" | "failed" | "retried" | "skipped";
  stage: "received" | "lead_downloaded" | "lead_stored" | "lead_assigned" | "completed" | null;
  error: string | null;
  retryCount: number;
  processingTimeMs: number | null;
  webhookLatencyMs: number | null;
  leadId: string | null;
  formId: string | null;
  createdAt: string;
  sourceName: string | null;
  formName: string | null;
};

const STATUS_META: Record<Log["status"], { label: string; className: string }> = {
  success: { label: "Success", className: "text-emerald-700 bg-emerald-50" },
  failed: { label: "Failed", className: "text-red-700 bg-red-50" },
  retried: { label: "Retried", className: "text-blue-700 bg-blue-50" },
  skipped: { label: "Skipped", className: "text-slate-500 bg-slate-100" },
};

const STAGE_LABELS: Record<NonNullable<Log["stage"]>, string> = {
  received: "Received",
  lead_downloaded: "Lead downloaded",
  lead_stored: "Lead stored",
  lead_assigned: "Lead assigned",
  completed: "Completed",
};

export default function DeliveryLogPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/webhook-logs");
    const data = await res.json();
    setLogs(data.logs || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function retry(id: string) {
    setRetryingId(id);
    await fetch(`/api/webhook-logs/${id}/retry`, { method: "POST" });
    setRetryingId(null);
    load();
  }

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Delivery Log</h1>
      <p className="text-sm text-slate-500 mb-6">
        Every lead delivery attempt from every connected source — Received → Lead downloaded → Lead stored → Lead
        assigned → Completed. If a delivery didn&apos;t complete, this shows exactly which step it stopped at.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Lead ID</th>
                <th className="px-4 py-3">Page</th>
                <th className="px-4 py-3">Form</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Processing Time</th>
                <th className="px-4 py-3">Errors</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    No deliveries yet.
                  </td>
                </tr>
              )}
              {logs.map((log) => {
                const meta = STATUS_META[log.status];
                return (
                  <tr key={log.id} className="border-b border-slate-50 last:border-0 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 text-xs">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {log.leadId ? log.leadId.slice(0, 8) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{log.sourceName || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{log.formName || log.formId || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${meta.className}`}>
                        {meta.label}
                      </span>
                      {log.stage && <div className="text-[11px] text-slate-400 mt-1">{STAGE_LABELS[log.stage]}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      {log.processingTimeMs != null ? `${log.processingTimeMs} ms` : "—"}
                      {log.webhookLatencyMs != null && (
                        <div className="text-[11px] text-slate-400">latency {log.webhookLatencyMs} ms</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-red-600 max-w-xs">{log.error || "—"}</td>
                    <td className="px-4 py-3">
                      {log.status === "failed" && (
                        <button
                          onClick={() => retry(log.id)}
                          disabled={retryingId === log.id}
                          className="text-xs font-medium text-white bg-slate-900 rounded-md px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
                        >
                          {retryingId === log.id ? "Retrying…" : "Retry"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
