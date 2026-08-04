"use client";

import { useEffect, useState } from "react";

type Defaults = { agentLeadVisibilityLimit: number; min: number; max: number };

// Platform Settings — global, platform-owner-only knobs (NOT per company).
// Today: the agent lead-visibility cap. Load current value, edit, save.
export default function PlatformSettingsPage() {
  const [limit, setLimit] = useState<string>("");
  const [saved, setSaved] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/super-admin/platform-settings")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.agentLeadVisibilityLimit === "number") {
          setLimit(String(d.agentLeadVisibilityLimit));
          setSaved(d.agentLeadVisibilityLimit);
        }
        if (d.defaults) setDefaults(d.defaults);
      })
      .catch(() => setMessage({ kind: "error", text: "Could not load platform settings." }))
      .finally(() => setLoading(false));
  }, []);

  const parsed = parseInt(limit, 10);
  const inRange = defaults ? Number.isFinite(parsed) && parsed >= defaults.min && parsed <= defaults.max : Number.isFinite(parsed);
  const dirty = saved !== null && Number.isFinite(parsed) && parsed !== saved;

  async function save() {
    if (!inRange) return;
    setSaving(true);
    setMessage(null);
    let res: Response;
    try {
      res = await fetch("/api/super-admin/platform-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentLeadVisibilityLimit: parsed }),
      });
    } catch {
      setSaving(false);
      setMessage({ kind: "error", text: "Save failed — network error. Your change is still here; click Save to retry." });
      return;
    }
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage({ kind: "error", text: data.error || "Save failed." });
      return;
    }
    const data = await res.json();
    setSaved(data.agentLeadVisibilityLimit);
    setLimit(String(data.agentLeadVisibilityLimit));
    setMessage({ kind: "ok", text: "Saved. Applies to every company's agents (allow a minute for open sessions)." });
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">Platform Settings</h1>
      <p className="text-sm text-slate-500 mt-1">
        Global controls for the whole platform. These are not per-company.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg p-5 mt-6">
        <h2 className="text-base font-semibold text-slate-900">Agent lead visibility limit</h2>
        <p className="text-sm text-slate-500 mt-1">
          The maximum number of their most-recently-assigned leads an agent can see in the CRM. Older assigned leads are
          hidden from the agent (never deleted — admins and managers still see the full history). Enforced at the
          database. Applies to every company.
        </p>

        {message && (
          <div
            role={message.kind === "error" ? "alert" : "status"}
            className={`text-sm mt-4 rounded-md border px-3 py-2 ${
              message.kind === "ok"
                ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                : "text-red-700 bg-red-50 border-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="mt-4 flex items-end gap-3">
          <div>
            <label htmlFor="agentLeadLimit" className="block text-xs font-medium text-slate-500 mb-1">
              Leads visible per agent
            </label>
            <input
              id="agentLeadLimit"
              type="number"
              inputMode="numeric"
              value={limit}
              disabled={loading}
              min={defaults?.min}
              max={defaults?.max}
              onChange={(e) => setLimit(e.target.value)}
              className="w-40 rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={save}
            disabled={loading || saving || !dirty || !inRange}
            className="text-white text-sm font-medium px-4 py-2 rounded-md bg-slate-900 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {defaults && (
          <p className="text-xs text-slate-400 mt-2">
            Allowed range {defaults.min.toLocaleString()}–{defaults.max.toLocaleString()}. Default {defaults.agentLeadVisibilityLimit.toLocaleString()}.
            {!inRange && Number.isFinite(parsed) && (
              <span className="text-red-500"> Value must be within the allowed range.</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
