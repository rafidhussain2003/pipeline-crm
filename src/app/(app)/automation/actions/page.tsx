"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/automation/shared";

type Action = { key: string; label: string; description: string; category: string; recordsIntent: boolean; placeholder: boolean };

export default function ActionsPage() {
  const [actions, setActions] = useState<Action[]>([]);
  useEffect(() => { fetch("/api/automation/actions").then(async (r) => { if (r.ok) setActions((await r.json()).actions || []); }); }, []);

  const byCategory: Record<string, Action[]> = {};
  for (const a of actions) (byCategory[a.category] ??= []).push(a);

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Actions" subtitle="What a workflow can do when it runs. New actions register themselves dynamically." />
      {Object.entries(byCategory).map(([cat, list]) => (
        <div key={cat} className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{cat}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {list.map((a) => (
              <div key={a.key} className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-900">{a.label}</span>
                  <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">{a.key}</span>
                  {a.placeholder && <span className="text-[10px] font-semibold uppercase text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">Placeholder</span>}
                  {!a.placeholder && a.recordsIntent && <span className="text-[10px] font-semibold uppercase text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">Records intent</span>}
                </div>
                <p className="text-xs text-slate-500 mt-1">{a.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
      {actions.length === 0 && <p className="text-sm text-slate-400">Loading…</p>}
    </div>
  );
}
