"use client";

import { useEffect, useState } from "react";

// Facebook Forms — the admin alias-management page. Every connected Lead Form
// is listed with its REAL Meta name (read-only, never editable) and the
// admin-editable Display Name (the alias agents see). Changing a Display Name
// updates every existing and future lead from that form immediately, because
// leads resolve their form name through this row at read time — nothing is
// copied onto lead records.

type FormRow = {
  id: string;
  sourceId: string;
  formId: string;
  formName: string | null; // actual (real) Meta name — read-only
  agentDisplayName: string | null; // editable alias
  enabled: boolean;
  pageName: string | null;
  platform: string;
};

export default function FacebookFormsPage() {
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/facebook-forms");
      if (res.status === 403) {
        setError("Only company admins can manage form display names.");
        setLoaded(true);
        return;
      }
      if (!res.ok) {
        setError(`Could not load forms (${res.status}).`);
        setLoaded(true);
        return;
      }
      setForms((await res.json()).forms || []);
      setError("");
    } catch {
      setError("Could not load forms.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveDisplayName(form: FormRow, value: string) {
    const trimmed = value.trim();
    if (trimmed === (form.agentDisplayName || "")) return; // no change
    setSavingId(form.id);
    setNotice("");
    try {
      const res = await fetch(`/api/lead-sources/${form.sourceId}/forms/${form.formId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentDisplayName: trimmed }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not save the display name.");
        return;
      }
      const saved = (await res.json()).form as { agentDisplayName: string | null };
      setForms((prev) => prev.map((f) => (f.id === form.id ? { ...f, agentDisplayName: saved.agentDisplayName } : f)));
      setError("");
      setNotice("Display name saved — this is the name agents see.");
    } catch {
      setError("Could not save the display name.");
    } finally {
      setSavingId(null);
    }
  }

  // Group by Page for a readable layout when a company has several pages.
  const byPage = new Map<string, FormRow[]>();
  for (const f of forms) {
    const key = f.pageName || "Facebook Page";
    const arr = byPage.get(key);
    if (arr) arr.push(f);
    else byPage.set(key, [f]);
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Facebook Forms</h1>
        <p className="text-sm text-slate-500">
          Give each Facebook Lead Form a friendly <strong>Display Name</strong> — this is the only name agents and
          managers ever see. The actual Facebook form name is shown here for your reference and can never be changed.
        </p>
      </div>

      {error && <div className="text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">{error}</div>}
      {notice && (
        <div role="status" className="text-sm bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-md px-3 py-2">
          {notice}
        </div>
      )}

      {!loaded && <div className="text-sm text-slate-400">Loading…</div>}
      {loaded && !error && forms.length === 0 && (
        <div className="text-sm text-slate-400 bg-white border border-slate-200 rounded-lg p-6">
          No Facebook forms connected yet. Connect a Page under <span className="font-medium">Lead Sources</span> to
          start receiving leads.
        </div>
      )}

      {loaded &&
        [...byPage.entries()].map(([page, rows]) => (
          <div key={page} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-semibold text-slate-800">{page}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                    <th className="px-4 py-2.5 w-1/2">Actual Facebook Form (read-only)</th>
                    <th className="px-4 py-2.5">Display Name (agents see this)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 align-middle">
                        <span className="text-slate-700">{f.formName || f.formId}</span>
                        {!f.enabled && (
                          <span className="ml-2 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                            Disabled
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <input
                          type="text"
                          defaultValue={f.agentDisplayName || ""}
                          placeholder={f.formName || "Display name for agents"}
                          disabled={savingId === f.id}
                          onBlur={(e) => saveDisplayName(f, e.target.value)}
                          aria-label={`Display name for ${f.formName || f.formId}`}
                          className="w-full max-w-sm text-sm rounded-md border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      {loaded && forms.length > 0 && (
        <p className="text-xs text-slate-400">
          Changing a Display Name takes effect immediately for every existing and future lead from that form — no lead
          records are rewritten.
        </p>
      )}
    </div>
  );
}
