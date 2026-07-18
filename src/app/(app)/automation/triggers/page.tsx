"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/automation/shared";

type Trigger = { key: string; label: string; module: string; description: string; kind: string; sampleVariables?: string[] };

export default function TriggersPage() {
  const [byModule, setByModule] = useState<Record<string, Trigger[]>>({});
  useEffect(() => { fetch("/api/automation/triggers").then(async (r) => { if (r.ok) setByModule((await r.json()).byModule || {}); }); }, []);

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Triggers" subtitle="Every event that can start a workflow. Future modules register new triggers automatically — no engine change." />
      {Object.entries(byModule).map(([mod, triggers]) => (
        <div key={mod} className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{mod.replace(/_/g, " ")}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {triggers.map((t) => (
              <div key={t.key} className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{t.label}</span>
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">{t.key}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{t.description}</p>
                {t.sampleVariables && t.sampleVariables.length > 0 && (
                  <div className="mt-2 text-[11px] text-slate-400">Variables: {t.sampleVariables.map((v) => <code key={v} className="mr-1">{v}.*</code>)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {Object.keys(byModule).length === 0 && <p className="text-sm text-slate-400">Loading…</p>}
    </div>
  );
}
