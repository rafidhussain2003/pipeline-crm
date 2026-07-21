"use client";

import { useEffect, useState } from "react";

type HealthCheck = { name: string; status: string; detail: string };
type SystemHealth = { status: string; checks: HealthCheck[]; system: { uptimeSeconds: number; memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number }; loadAvg1m: number | null; cpuCount: number; nodeVersion: string }; cache: { hits: number; misses: number; size: number }; timings: Record<string, { count: number; avgMs: number | null; p95Ms: number | null; maxMs: number | null }>; generatedAt: string };
type QueueStats = { name: string; running: number; queued: number; deadLetter: number; completedOrSent: number; retried: number; avgProcessingMs: number | null; deadLetterJobs: { id: string; leadId: string | null; attempts: number; lastError: string | null }[] };
type JobDashboard = { queues: QueueStats[]; workers: { assignmentWorker: string; capiWorker: string; note: string } };
type ConfigCheck = { name: string; status: string; detail: string; required: boolean };
type ConfigReport = { status: string; checks: ConfigCheck[] };
type ChecklistItem = { name: string; state: string; detail: string };
type Checklist = { ready: boolean; items: ChecklistItem[] };

const DOT: Record<string, string> = { healthy: "bg-green-500", warning: "bg-amber-500", critical: "bg-red-500", pass: "bg-green-500", warn: "bg-amber-500", fail: "bg-red-500", missing: "bg-red-500" };
const TXT: Record<string, string> = { healthy: "text-green-700", warning: "text-amber-700", critical: "text-red-700", pass: "text-green-700", warn: "text-amber-700", fail: "text-red-700", missing: "text-red-700" };

export default function DiagnosticsPage() {
  const [tab, setTab] = useState<"checklist" | "health" | "jobs" | "config">("checklist");
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [jobs, setJobs] = useState<JobDashboard | null>(null);
  const [config, setConfig] = useState<ConfigReport | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const [h, j, c, k] = await Promise.all([fetch("/api/super-admin/health"), fetch("/api/super-admin/jobs"), fetch("/api/super-admin/config-check"), fetch("/api/super-admin/checklist")]);
    setHealth(await h.json().catch(() => null));
    setJobs(await j.json().catch(() => null));
    setConfig(await c.json().catch(() => null));
    setChecklist(await k.json().catch(() => null));
    setLoaded(true);
  }
  useEffect(() => { load(); }, []);

  async function retry(queue: string, id: string) {
    await fetch("/api/super-admin/jobs/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queue, id }) });
    load();
  }

  // Database migrations, on demand — shows the migrator's exact outcome
  // (success or the real failure reason) instead of hiding it in boot logs.
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ ok: boolean; detail: string } | null>(null);

  async function runMigrations() {
    setMigrating(true);
    setMigrationResult(null);
    try {
      const res = await fetch("/api/super-admin/run-migrations", { method: "POST" });
      setMigrationResult(await res.json());
    } catch {
      setMigrationResult({ ok: false, detail: "Request failed — check your connection and try again." });
    } finally {
      setMigrating(false);
    }
  }

  if (!loaded) return <div className="p-6 text-sm text-slate-400">Loading diagnostics…</div>;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Platform Diagnostics</h1>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-md border border-slate-200">Refresh</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">Database migrations</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Apply any pending schema/data migrations now and see the result immediately.
          </div>
          {migrationResult && (
            <div className={`text-xs mt-2 rounded-md border px-2.5 py-1.5 break-all ${migrationResult.ok ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-red-700 bg-red-50 border-red-200"}`}>
              {migrationResult.ok ? "✓ " : "✗ "}
              {migrationResult.detail}
            </div>
          )}
        </div>
        <button
          onClick={runMigrations}
          disabled={migrating}
          className="shrink-0 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
        >
          {migrating ? "Running…" : "Run migrations"}
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {([["checklist", "Launch Checklist"], ["health", "System Health"], ["jobs", "Jobs"], ["config", "Config Validator"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`text-sm px-3 py-2 -mb-px border-b-2 ${tab === k ? "border-slate-900 text-slate-900 font-medium" : "border-transparent text-slate-500"}`}>{label}</button>
        ))}
      </div>

      {tab === "checklist" && checklist && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className={`text-sm font-semibold mb-3 ${checklist.ready ? "text-green-700" : "text-red-700"}`}>{checklist.ready ? "✓ Ready for launch — no blocking items" : "✗ Not ready — resolve failing items below"}</div>
          <div className="space-y-2">
            {checklist.items.map((i) => (
              <div key={i.name} className="flex items-start gap-2">
                <span className={`inline-block w-2 h-2 rounded-full mt-1.5 ${DOT[i.state]}`} />
                <div><div className="text-sm text-slate-800">{i.name}</div><div className="text-xs text-slate-500">{i.detail}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "health" && health && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center gap-2 mb-3"><span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[health.status]}`} /><h2 className="text-sm font-semibold text-slate-700">Overall: <span className={TXT[health.status]}>{health.status}</span></h2></div>
            <div className="space-y-1.5">
              {health.checks.map((c) => (
                <div key={c.name} className="flex items-start gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full mt-1.5 ${DOT[c.status]}`} />
                  <div><span className="text-sm text-slate-800 capitalize">{c.name.replace(/_/g, " ")}</span> <span className="text-xs text-slate-500">— {c.detail}</span></div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Uptime", `${Math.round(health.system.uptimeSeconds / 60)}m`],
              ["Heap", `${health.system.memory.heapUsedMb}/${health.system.memory.heapTotalMb}MB`],
              ["RSS", `${health.system.memory.rssMb}MB`],
              ["Load (1m)", health.system.loadAvg1m != null ? String(health.system.loadAvg1m) : "—"],
              ["CPUs", String(health.system.cpuCount)],
              ["Node", health.system.nodeVersion],
              ["Cache", `${health.cache.hits}h/${health.cache.misses}m`],
              ["Assign p95", health.timings["assignment.decision_ms"]?.p95Ms != null ? `${health.timings["assignment.decision_ms"].p95Ms}ms` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="bg-white border border-slate-200 rounded-md p-2 text-center"><div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div><div className="text-sm font-medium text-slate-800 truncate">{v}</div></div>
            ))}
          </div>
        </div>
      )}

      {tab === "jobs" && jobs && (
        <div className="space-y-4">
          {jobs.queues.map((q) => (
            <div key={q.name} className="bg-white border border-slate-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3 capitalize">{q.name.replace(/_/g, " ")} queue</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                {[["Running", q.running], ["Queued", q.queued], ["Dead-letter", q.deadLetter], ["Done", q.completedOrSent], ["Retried", q.retried], ["Avg", q.avgProcessingMs != null ? `${q.avgProcessingMs}ms` : "—"]].map(([k, v]) => (
                  <div key={k as string} className="bg-slate-50 rounded-md p-2 text-center"><div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div><div className={`text-sm font-medium ${k === "Dead-letter" && Number(v) > 0 ? "text-red-600" : "text-slate-800"}`}>{v}</div></div>
                ))}
              </div>
              {q.deadLetterJobs.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-500">Dead-letter jobs</div>
                  {q.deadLetterJobs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-xs border-t border-slate-100 py-1.5">
                      <div className="truncate"><span className="text-slate-500">{d.leadId?.slice(0, 8) || d.id.slice(0, 8)}…</span> <span className="text-red-600">{d.lastError?.slice(0, 60) || "failed"}</span> <span className="text-slate-400">({d.attempts}×)</span></div>
                      <button onClick={() => retry(q.name, d.id)} className="text-blue-600 shrink-0 ml-2">Retry</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-slate-400">{jobs.workers.note}</p>
        </div>
      )}

      {tab === "config" && config && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className={`text-sm font-semibold mb-3 ${TXT[config.status]}`}>Required config: {config.status}</div>
          <div className="space-y-2">
            {config.checks.map((c) => (
              <div key={c.name} className="flex items-start gap-2">
                <span className={`inline-block w-2 h-2 rounded-full mt-1.5 ${DOT[c.status]}`} />
                <div><span className="text-sm text-slate-800">{c.name}</span> {!c.required && <span className="text-[10px] text-slate-400">(optional)</span>}<div className="text-xs text-slate-500">{c.detail}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
