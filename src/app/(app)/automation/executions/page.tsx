"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader, StatusBadge, relTime } from "@/components/automation/shared";

type Execution = { id: string; workflowName: string | null; triggerType: string; triggerSource: string; status: string; attempts: number; durationMs: number | null; createdAt: string };
type Log = { id: string; position: number; actionType: string; status: string; message: string | null; durationMs: number | null; output: unknown };
type Detail = Execution & { input: unknown; error: string | null; maxRetries: number; conditionResult: unknown; logs: Log[] };

const STATUSES = ["", "success", "skipped", "retrying", "dead_letter"];

export default function ExecutionsPage() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [status, setStatus] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);

  const load = useCallback(async (st: string) => {
    const r = await fetch(`/api/automation/executions${st ? `?status=${st}` : ""}`);
    if (r.ok) setExecutions((await r.json()).executions || []);
  }, []);

  const openDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/automation/executions/${id}`);
    if (r.ok) setDetail((await r.json()).execution);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const st = params.get("status") || "";
    setStatus(st);
    load(st);
    const focus = params.get("focus");
    if (focus) openDetail(focus);
  }, [load, openDetail]);

  useEffect(() => { load(status); }, [status, load]);

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Execution History" subtitle="Every workflow run — inputs, conditions, per-action logs, retries and outcome." />

      <div className="flex gap-1.5 mb-4">
        {STATUSES.map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} className={`text-xs font-medium rounded-full px-3 py-1.5 ${status === s ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            {s ? s.replace(/_/g, " ") : "All"}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {executions.map((e) => (
          <button key={e.id} onClick={() => openDetail(e.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left">
            <StatusBadge status={e.status} kind="execution" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{e.workflowName || "—"}</div>
              <div className="text-xs text-slate-400">{e.triggerType} · {e.triggerSource}{e.attempts > 1 ? ` · ${e.attempts} attempts` : ""}</div>
            </div>
            <div className="text-xs text-slate-400 shrink-0">{e.durationMs != null ? `${e.durationMs}ms · ` : ""}{relTime(e.createdAt)}</div>
          </button>
        ))}
        {executions.length === 0 && <p className="text-sm text-slate-400 px-4 py-10 text-center">No executions{status ? ` with status "${status.replace(/_/g, " ")}"` : ""}.</p>}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{detail.workflowName || "Execution"}</h2>
                <div className="flex items-center gap-2 mt-1"><StatusBadge status={detail.status} kind="execution" /><span className="text-xs text-slate-400">{detail.triggerType} · {detail.triggerSource} · {detail.attempts}/{detail.maxRetries + 1} attempts{detail.durationMs != null ? ` · ${detail.durationMs}ms` : ""}</span></div>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            {detail.error && <div className="mb-3 text-xs text-red-700 bg-red-50 rounded-md px-3 py-2">{detail.error}</div>}

            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Trigger input</h3>
            <pre className="text-[11px] bg-slate-50 rounded-md p-3 overflow-x-auto mb-4 text-slate-700">{JSON.stringify(detail.input, null, 2)}</pre>

            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Action logs</h3>
            <div className="space-y-2">
              {detail.logs.map((l) => (
                <div key={l.id} className="border border-slate-200 rounded-md p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-500">#{l.position + 1}</span>
                    <span className="text-sm font-medium text-slate-800">{l.actionType}</span>
                    <StatusBadge status={l.status} kind="execution" />
                    {l.durationMs != null && <span className="text-[11px] text-slate-400 ml-auto">{l.durationMs}ms</span>}
                  </div>
                  {l.message && <p className="text-xs text-slate-500 mt-1">{l.message}</p>}
                </div>
              ))}
              {detail.logs.length === 0 && <p className="text-sm text-slate-400">No action logs (conditions may not have matched).</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
