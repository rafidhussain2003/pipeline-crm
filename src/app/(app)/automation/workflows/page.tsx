"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader, StatusBadge, relTime } from "@/components/automation/shared";

const OPERATORS = [
  "equals", "not_equals", "contains", "starts_with", "ends_with",
  "greater_than", "less_than", "date_before", "date_after",
  "is_true", "is_false", "is_empty", "is_not_empty",
];
const NO_VALUE = new Set(["is_true", "is_false", "is_empty", "is_not_empty"]);

type Trigger = { key: string; label: string; module: string };
type ActionField = { key: string; label: string; type: string; options?: string[]; placeholder?: string };
type ActionDef = { key: string; label: string; category: string; configFields: ActionField[]; placeholder: boolean; recordsIntent: boolean };
type Step = { actionType: string; config: Record<string, string>; continueOnError: boolean };
type CondRow = { field: string; operator: string; value: string };
type WorkflowStep = { id: string; position: number; actionType: string; config: Record<string, unknown>; continueOnError: boolean };
type Workflow = {
  id: string; name: string; description: string | null; status: string; version: number;
  triggerType: string; triggerLabel: string; conditions: unknown; retryConfig: { maxRetries?: number; backoffSeconds?: number } | null;
  actions: WorkflowStep[]; executionCount: number; lastExecutedAt: string | null;
};
type WorkflowRow = { id: string; name: string; status: string; triggerLabel: string; actionCount: number; executionCount: number; lastExecutedAt: string | null };

export default function WorkflowsPage() {
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [actionDefs, setActionDefs] = useState<ActionDef[]>([]);
  const [editor, setEditor] = useState<Workflow | "new" | null>(null);
  const [versionsFor, setVersionsFor] = useState<{ name: string; versions: { version: number; createdAt: string }[] } | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => { const r = await fetch("/api/automation/workflows"); if (r.ok) setRows((await r.json()).workflows || []); }, []);
  useEffect(() => {
    load();
    fetch("/api/automation/triggers").then(async (r) => { if (r.ok) setTriggers((await r.json()).triggers || []); });
    fetch("/api/automation/actions").then(async (r) => { if (r.ok) setActionDefs((await r.json()).actions || []); });
  }, [load]);

  async function openEdit(id: string) { const r = await fetch(`/api/automation/workflows/${id}`); if (r.ok) setEditor((await r.json()).workflow); }
  async function lifecycle(id: string, op: string) {
    setBanner(null);
    const r = await fetch(`/api/automation/workflows/${id}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op }) });
    if (!r.ok) { setBanner({ kind: "error", text: (await r.json().catch(() => ({}))).error || "Failed" }); return; }
    setBanner({ kind: "ok", text: `Workflow ${op === "duplicate" ? "duplicated" : op + "d"}.` });
    load();
  }
  async function run(id: string) {
    setBanner(null);
    const r = await fetch(`/api/automation/workflows/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: {} }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setBanner({ kind: "error", text: d.error || "Run failed" }); return; }
    setBanner({ kind: "ok", text: `Ran workflow → ${d.result?.status ?? "done"}. See Execution History.` });
    load();
  }
  async function showVersions(w: WorkflowRow) {
    const r = await fetch(`/api/automation/workflows/${w.id}/versions`);
    if (r.ok) setVersionsFor({ name: w.name, versions: (await r.json()).versions || [] });
  }

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Workflows" subtitle="Build, publish and manage automations." action={<button onClick={() => setEditor("new")} className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md">New workflow</button>} />
      {banner && <p className={`text-xs mb-3 ${banner.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{banner.text}</p>}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {rows.map((w) => (
          <div key={w.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2"><span className="text-sm font-medium text-slate-900 truncate">{w.name}</span><StatusBadge status={w.status} /></div>
              <div className="text-xs text-slate-400">{w.triggerLabel} · {w.actionCount} action(s) · {w.executionCount} run(s){w.lastExecutedAt ? ` · last ${relTime(w.lastExecutedAt)}` : ""}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0 text-xs">
              {w.status !== "archived" && <button onClick={() => openEdit(w.id)} className="font-medium text-slate-600 hover:bg-slate-100 rounded px-2 py-1">Edit</button>}
              {w.status !== "published" && w.status !== "archived" && <button onClick={() => lifecycle(w.id, "publish")} className="font-medium text-emerald-700 bg-emerald-50 rounded px-2 py-1">Publish</button>}
              {w.status === "published" && <button onClick={() => lifecycle(w.id, "disable")} className="font-medium text-amber-700 bg-amber-50 rounded px-2 py-1">Disable</button>}
              {(w.status === "published" || w.status === "disabled") && <button onClick={() => run(w.id)} className="font-medium text-indigo-700 bg-indigo-50 rounded px-2 py-1">Run</button>}
              <button onClick={() => lifecycle(w.id, "duplicate")} className="font-medium text-slate-600 hover:bg-slate-100 rounded px-2 py-1">Duplicate</button>
              <button onClick={() => showVersions(w)} className="font-medium text-slate-600 hover:bg-slate-100 rounded px-2 py-1">Versions</button>
              {w.status !== "archived" && <button onClick={() => lifecycle(w.id, "archive")} className="font-medium text-slate-400 hover:bg-slate-100 rounded px-2 py-1">Archive</button>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-400 px-4 py-10 text-center">No workflows yet. Create one or start from a template.</p>}
      </div>

      {editor && <Builder existing={editor === "new" ? null : editor} triggers={triggers} actionDefs={actionDefs} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); }} />}
      {versionsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setVersionsFor(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 mb-3">Version history — {versionsFor.name}</h2>
            <div className="divide-y divide-slate-100">
              {versionsFor.versions.map((v) => <div key={v.version} className="flex items-center justify-between py-2 text-sm"><span className="font-medium text-slate-700">v{v.version}</span><span className="text-xs text-slate-400">{relTime(v.createdAt)}</span></div>)}
              {versionsFor.versions.length === 0 && <p className="text-sm text-slate-400 py-4">Not published yet — no versions.</p>}
            </div>
            <div className="flex justify-end mt-4"><button onClick={() => setVersionsFor(null)} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Builder({ existing, triggers, actionDefs, onClose, onSaved }: { existing: Workflow | null; triggers: Trigger[]; actionDefs: ActionDef[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [triggerType, setTriggerType] = useState(existing?.triggerType ?? "");
  const initCond = (existing?.conditions ?? null) as { logic?: string; conditions?: CondRow[] } | null;
  const [logic, setLogic] = useState(initCond?.logic === "or" ? "or" : "and");
  const [condRows, setCondRows] = useState<CondRow[]>(
    Array.isArray(initCond?.conditions) ? (initCond!.conditions as CondRow[]).filter((c) => c && c.field).map((c) => ({ field: c.field, operator: c.operator, value: c.value == null ? "" : String(c.value) })) : [],
  );
  const [steps, setSteps] = useState<Step[]>(
    (existing?.actions ?? []).map((a) => ({ actionType: a.actionType, config: Object.fromEntries(Object.entries(a.config ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])), continueOnError: a.continueOnError })),
  );
  const [maxRetries, setMaxRetries] = useState(existing?.retryConfig?.maxRetries ?? 3);
  const [backoff, setBackoff] = useState(existing?.retryConfig?.backoffSeconds ?? 30);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function addStep() { setSteps([...steps, { actionType: actionDefs[0]?.key ?? "", config: {}, continueOnError: false }]); }
  function move(i: number, d: number) { const j = i + d; if (j < 0 || j >= steps.length) return; const s = [...steps]; [s[i], s[j]] = [s[j], s[i]]; setSteps(s); }

  async function save() {
    setError("");
    if (!name.trim()) { setError("Name is required"); return; }
    if (!triggerType) { setError("Choose a trigger"); return; }
    setSaving(true);
    const payload = {
      name, description,
      triggerType,
      conditions: condRows.length ? { logic, conditions: condRows.map((c) => ({ field: c.field, operator: c.operator, value: NO_VALUE.has(c.operator) ? undefined : c.value })) } : null,
      retryConfig: { maxRetries, backoffSeconds: backoff },
      actions: steps.filter((s) => s.actionType).map((s) => ({ actionType: s.actionType, config: s.config, continueOnError: s.continueOnError })),
    };
    const url = existing ? `/api/automation/workflows/${existing.id}` : "/api/automation/workflows";
    const r = await fetch(url, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not save"); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900 mb-4">{existing ? "Edit workflow" : "New workflow"}</h2>
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Name</label><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Trigger</label>
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="">Choose a trigger…</option>
                {triggers.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Description</label><input value={description ?? ""} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>

          {/* Conditions */}
          <div className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600">Conditions</span>
              <div className="flex items-center gap-2">
                <select value={logic} onChange={(e) => setLogic(e.target.value)} className="text-xs rounded border border-slate-200 px-2 py-1"><option value="and">Match ALL (AND)</option><option value="or">Match ANY (OR)</option></select>
                <button onClick={() => setCondRows([...condRows, { field: "", operator: "equals", value: "" }])} className="text-xs font-medium text-indigo-700">+ condition</button>
              </div>
            </div>
            {condRows.length === 0 && <p className="text-[11px] text-slate-400">No conditions — the workflow runs on every trigger.</p>}
            {condRows.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 mb-1.5">
                <input value={c.field} onChange={(e) => { const r = [...condRows]; r[i] = { ...c, field: e.target.value }; setCondRows(r); }} placeholder="lead.status" className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs font-mono" />
                <select value={c.operator} onChange={(e) => { const r = [...condRows]; r[i] = { ...c, operator: e.target.value }; setCondRows(r); }} className="rounded border border-slate-200 px-2 py-1 text-xs">
                  {OPERATORS.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                </select>
                {!NO_VALUE.has(c.operator) && <input value={c.value} onChange={(e) => { const r = [...condRows]; r[i] = { ...c, value: e.target.value }; setCondRows(r); }} placeholder="value" className="w-24 rounded border border-slate-200 px-2 py-1 text-xs" />}
                <button onClick={() => setCondRows(condRows.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500 text-sm px-1">×</button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600">Actions ({steps.length})</span>
              <button onClick={addStep} className="text-xs font-medium text-indigo-700">+ action</button>
            </div>
            {steps.length === 0 && <p className="text-[11px] text-slate-400">Add at least one action for the workflow to do something.</p>}
            {steps.map((s, i) => {
              const def = actionDefs.find((a) => a.key === s.actionType);
              return (
                <div key={i} className="border border-slate-100 bg-slate-50 rounded-md p-2.5 mb-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[11px] font-mono text-slate-400">#{i + 1}</span>
                    <select value={s.actionType} onChange={(e) => { const st = [...steps]; st[i] = { ...s, actionType: e.target.value, config: {} }; setSteps(st); }} className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs bg-white">
                      {actionDefs.map((a) => <option key={a.key} value={a.key}>{a.label}{a.placeholder ? " (placeholder)" : ""}</option>)}
                    </select>
                    <button onClick={() => move(i, -1)} className="text-slate-400 hover:text-slate-700 px-1 text-xs">↑</button>
                    <button onClick={() => move(i, 1)} className="text-slate-400 hover:text-slate-700 px-1 text-xs">↓</button>
                    <button onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500 text-sm px-1">×</button>
                  </div>
                  {def?.configFields?.map((f) => (
                    <div key={f.key} className="flex items-center gap-2 mb-1">
                      <label className="text-[11px] text-slate-500 w-28 shrink-0">{f.label}</label>
                      {f.type === "select" ? (
                        <select value={s.config[f.key] ?? ""} onChange={(e) => { const st = [...steps]; st[i] = { ...s, config: { ...s.config, [f.key]: e.target.value } }; setSteps(st); }} className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs bg-white">
                          <option value="">—</option>
                          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input value={s.config[f.key] ?? ""} onChange={(e) => { const st = [...steps]; st[i] = { ...s, config: { ...s.config, [f.key]: e.target.value } }; setSteps(st); }} placeholder={f.placeholder} className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs" />
                      )}
                    </div>
                  ))}
                  <label className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500"><input type="checkbox" checked={s.continueOnError} onChange={(e) => { const st = [...steps]; st[i] = { ...s, continueOnError: e.target.checked }; setSteps(st); }} /> Continue if this step fails</label>
                </div>
              );
            })}
          </div>

          {/* Retry */}
          <div className="flex items-center gap-4">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Max retries</label><input type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(Number(e.target.value))} className="w-20 rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Backoff (s)</label><input type="number" min={1} max={3600} value={backoff} onChange={(e) => setBackoff(Number(e.target.value))} className="w-20 rounded-md border border-slate-200 px-3 py-2 text-sm" /></div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">{saving ? "Saving…" : existing ? "Save changes" : "Create draft"}</button>
        </div>
      </div>
    </div>
  );
}
