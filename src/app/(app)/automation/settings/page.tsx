"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/automation/shared";

type Settings = { defaultMaxRetries: number; defaultBackoffSeconds: number; executionRetentionDays: number };

export default function AutomationSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = async () => { const r = await fetch("/api/automation/settings"); if (r.ok) setS((await r.json()).settings); };
  useEffect(() => { load(); }, []);

  async function save(patch: Partial<Settings>) {
    setMsg(null);
    const r = await fetch("/api/automation/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!r.ok) setMsg({ kind: "error", text: (await r.json().catch(() => ({}))).error || "Could not save" });
    else { setMsg({ kind: "ok", text: "Saved." }); load(); }
  }

  if (!s) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const Num = ({ label, field, hint, min, max }: { label: string; field: keyof Settings; hint: string; min: number; max: number }) => (
    <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-1">{label}</h2>
      <p className="text-xs text-slate-400 mb-3">{hint}</p>
      <input type="number" min={min} max={max} defaultValue={s[field]} onBlur={(e) => { const v = Number(e.target.value); if (v !== s[field]) save({ [field]: v } as Partial<Settings>); }} className="w-32 rounded-md border border-slate-200 px-3 py-2 text-sm" />
    </div>
  );

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Automation Settings" subtitle="Default retry policy new workflows inherit." />
      {msg && <p className={`text-xs mb-3 ${msg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      <Num label="Default max retries" field="defaultMaxRetries" hint="How many times a failed execution retries before entering the dead-letter queue (0–10)." min={0} max={10} />
      <Num label="Default backoff (seconds)" field="defaultBackoffSeconds" hint="Base delay for exponential backoff between retries (doubles each attempt)." min={1} max={3600} />
      <Num label="Execution retention (days)" field="executionRetentionDays" hint="How long execution history is kept (placeholder — pruning is a future phase)." min={1} max={3650} />
    </div>
  );
}
