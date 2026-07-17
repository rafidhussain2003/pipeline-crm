"use client";

import { useEffect, useMemo, useState } from "react";

type Company = { id: string; name: string; plan: string; status: string; subscriptionStatus: string };
type FeatureDef = { key: string; label: string; description: string; defaultEnabled: boolean; core?: boolean; placeholder?: boolean };

// Phase 18 — Platform Owner Feature Management: search a company, open its
// profile, toggle modules, save. Toggles are local until Save so the owner can
// review a package change before applying it; each applied change is audited.
export default function FeatureManagementPage() {
  const [allCompanies, setAllCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Company | null>(null);
  const [catalog, setCatalog] = useState<FeatureDef[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/super-admin/companies")
      .then((r) => r.json())
      .then((d) => setAllCompanies(d.companies || []));
  }, []);

  const companies = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? allCompanies.filter((c) => c.name.toLowerCase().includes(q)) : allCompanies;
    return list.slice(0, 50);
  }, [allCompanies, search]);

  async function openCompany(company: Company) {
    setSelected(company);
    setMessage(null);
    const res = await fetch(`/api/super-admin/companies/${company.id}/features`);
    if (!res.ok) {
      setMessage({ kind: "error", text: "Could not load this company's features." });
      return;
    }
    const data = await res.json();
    setCatalog(data.catalog || []);
    setEnabled(data.enabled || {});
    setDraft(data.enabled || {});
  }

  function toggle(key: string) {
    setDraft((d) => ({ ...d, [key]: !d[key] }));
  }

  const dirty = useMemo(() => catalog.some((f) => draft[f.key] !== enabled[f.key]), [catalog, draft, enabled]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    // Send only the changed keys — the audit trail then records exactly what
    // the owner changed, nothing else.
    const patch: Record<string, boolean> = {};
    for (const f of catalog) if (draft[f.key] !== enabled[f.key]) patch[f.key] = draft[f.key];
    const res = await fetch(`/api/super-admin/companies/${selected.id}/features`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: patch }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage({ kind: "error", text: data.error || "Save failed." });
      return;
    }
    const data = await res.json();
    setEnabled(data.enabled);
    setDraft(data.enabled);
    setMessage({ kind: "ok", text: "Saved. Changes take effect for the company within a minute." });
  }

  const enabledList = catalog.filter((f) => draft[f.key]);
  const disabledList = catalog.filter((f) => !draft[f.key]);

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Feature Management</h1>
      <p className="text-sm text-slate-500 mt-1">Control which modules each company can access. Disabled modules disappear completely for that company.</p>

      <div className="grid md:grid-cols-[280px_1fr] gap-6 mt-6">
        {/* Company search + list */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 h-fit">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search companies…"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm mb-2"
          />
          <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => openCompany(c)}
                className={`w-full text-left px-2.5 py-2 rounded-md text-sm ${
                  selected?.id === c.id ? "bg-purple-50 text-purple-700 font-medium" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div className="truncate">{c.name}</div>
                <div className="text-[11px] text-slate-400 capitalize">{c.plan} · {c.subscriptionStatus}</div>
              </button>
            ))}
            {companies.length === 0 && <p className="text-xs text-slate-400 px-2 py-3">No companies match.</p>}
          </div>
        </div>

        {/* Company feature profile */}
        {!selected ? (
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-400 h-fit">
            Select a company to manage its modules.
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{selected.name}</h2>
                <p className="text-xs text-slate-400 capitalize mt-0.5">{selected.plan} plan · {selected.subscriptionStatus}</p>
              </div>
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            {message && (
              <p className={`text-xs mb-3 ${message.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{message.text}</p>
            )}

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 mb-2">
                  Enabled modules ({enabledList.length})
                </div>
                <div className="space-y-1.5">
                  {enabledList.map((f) => (
                    <FeatureRow key={f.key} f={f} on onToggle={() => toggle(f.key)} changed={draft[f.key] !== enabled[f.key]} />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  Disabled modules ({disabledList.length})
                </div>
                <div className="space-y-1.5">
                  {disabledList.map((f) => (
                    <FeatureRow key={f.key} f={f} on={false} onToggle={() => toggle(f.key)} changed={draft[f.key] !== enabled[f.key]} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureRow({ f, on, onToggle, changed }: { f: FeatureDef; on: boolean; onToggle: () => void; changed: boolean }) {
  return (
    <div className={`border rounded-md px-3 py-2 flex items-center justify-between gap-3 ${changed ? "border-amber-300 bg-amber-50/50" : "border-slate-200"}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
          {f.label}
          {f.core && <span className="text-[10px] font-semibold text-slate-400 uppercase">Core</span>}
          {f.placeholder && <span className="text-[10px] font-semibold text-purple-500 uppercase">Coming soon</span>}
        </div>
        <div className="text-[11px] text-slate-400 truncate">{f.description}</div>
      </div>
      <button
        onClick={onToggle}
        disabled={f.core}
        title={f.core ? "Core modules cannot be disabled" : undefined}
        className={`shrink-0 text-xs font-medium rounded-full px-3 py-1 disabled:opacity-40 ${
          on ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"
        }`}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}
