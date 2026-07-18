"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/automation/shared";

type Template = { key: string; name: string; description: string; category: string; triggerType: string; actionCount: number };

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/automation/templates").then(async (r) => { if (r.ok) setTemplates((await r.json()).templates || []); }); }, []);

  async function useTemplate(key: string) {
    setBusy(key); setError("");
    const r = await fetch("/api/automation/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    setBusy("");
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "Could not create workflow"); return; }
    router.push("/automation/workflows");
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Templates" subtitle="Start from a proven pattern. Instantiating a template creates an editable draft workflow." />
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {templates.map((t) => (
          <div key={t.key} className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{t.name}</span>
              <span className="text-[10px] font-semibold uppercase text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">{t.category}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 flex-1">{t.description}</p>
            <div className="flex items-center justify-between mt-3">
              <span className="text-[11px] text-slate-400 font-mono">{t.triggerType} · {t.actionCount} action(s)</span>
              <button onClick={() => useTemplate(t.key)} disabled={busy === t.key} className="text-xs font-medium text-indigo-700 bg-indigo-50 rounded px-3 py-1.5 disabled:opacity-50">
                {busy === t.key ? "Creating…" : "Use template"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {templates.length === 0 && <p className="text-sm text-slate-400">Loading…</p>}
    </div>
  );
}
