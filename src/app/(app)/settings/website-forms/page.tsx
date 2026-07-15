"use client";

import { useEffect, useState } from "react";

type Connection = {
  publicKey: string;
  secretKey: string | null;
  embedEndpoint: string;
  webhookEndpoint: string;
  sdkSnippet: string;
  allowedDomains: string[];
};

type HostedForm = { id: string; name: string; sourceId: string; active: boolean; createdAt: string; fields: BuilderField[] };

type FieldType = "text" | "email" | "phone" | "textarea" | "dropdown" | "checkbox";
type BuilderField = { type: FieldType; label: string; name: string; required: boolean; options?: string[] };

const FIELD_TYPES: FieldType[] = ["text", "email", "phone", "textarea", "dropdown", "checkbox"];

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

export default function WebsiteFormsPage() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [forms, setForms] = useState<HostedForm[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [domainsText, setDomainsText] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState("");
  const [savingDomains, setSavingDomains] = useState(false);

  // Builder state
  const [formName, setFormName] = useState("");
  const [submitText, setSubmitText] = useState("Submit");
  const [successMessage, setSuccessMessage] = useState("");
  const [fields, setFields] = useState<BuilderField[]>([
    { type: "text", label: "Name", name: "name", required: true },
    { type: "email", label: "Email", name: "email", required: true },
    { type: "phone", label: "Phone", name: "phone", required: false },
  ]);
  const [creating, setCreating] = useState(false);
  const [builderError, setBuilderError] = useState("");

  async function load() {
    const [connRes, formsRes] = await Promise.all([fetch("/api/website/connection"), fetch("/api/website/hosted-forms")]);
    const connData = await connRes.json();
    const formsData = await formsRes.json();
    setConnection(connData.connection || null);
    setDomainsText((connData.connection?.allowedDomains || []).join("\n"));
    setForms(formsData.forms || []);
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, []);

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  }

  async function saveDomains() {
    setSavingDomains(true);
    const allowedDomains = domainsText.split(/[\n,]/).map((d) => d.trim()).filter(Boolean);
    const res = await fetch("/api/website/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedDomains }),
    });
    const data = await res.json();
    if (data.connection) {
      setConnection(data.connection);
      setDomainsText((data.connection.allowedDomains || []).join("\n"));
    }
    setSavingDomains(false);
  }

  async function rotateSecret() {
    if (!confirm("Rotate the secret key? Any server-to-server integration using the old key will stop working until updated.")) return;
    const res = await fetch("/api/website/connection/rotate", { method: "POST" });
    const data = await res.json();
    if (data.secretKey && connection) setConnection({ ...connection, secretKey: data.secretKey });
  }

  function updateField(i: number, patch: Partial<BuilderField>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addField() {
    setFields((prev) => [...prev, { type: "text", label: "", name: "", required: false }]);
  }

  async function createForm() {
    setBuilderError("");
    if (!formName.trim()) return setBuilderError("Give the form a name.");
    const payload = fields
      .map((f) => ({ ...f, name: f.name.trim() || slugify(f.label), options: f.type === "dropdown" ? (f.options || []) : undefined }))
      .filter((f) => f.label.trim() || f.name);
    if (!payload.some((f) => f.type === "email" || f.type === "phone")) {
      return setBuilderError("Include at least one email or phone field.");
    }
    setCreating(true);
    const res = await fetch("/api/website/hosted-forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formName, submitText, successMessage: successMessage || null, fields: payload }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) return setBuilderError(data.error || "Could not create form.");
    setFormName("");
    setSuccessMessage("");
    await load();
  }

  if (!loaded) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Website Forms</h1>
        <p className="text-sm text-slate-500 mt-1">
          Capture leads from your own website — paste one line of code on any form, or build a hosted form here. Submissions flow into
          the same pipeline (dedup, auto-assignment, delivery log) as every other source.
        </p>
      </div>

      {/* Connection / keys / snippet */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Your website connection</h2>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Embed snippet (paste before &lt;/body&gt;)</label>
          <div className="flex gap-2">
            <code className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-800 overflow-x-auto whitespace-nowrap">
              {connection ? connection.sdkSnippet : "Create a form below to generate your snippet."}
            </code>
            {connection && (
              <button onClick={() => copy(connection.sdkSnippet, "snippet")} className="shrink-0 text-xs font-medium px-3 py-2 rounded-md bg-slate-900 text-white">
                {copied === "snippet" ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Auto-detects lead forms (any form with an email or phone field). No per-form setup needed.</p>
        </div>

        {connection && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Public key (safe to embed)</label>
                <div className="flex gap-2">
                  <code className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-700 overflow-x-auto whitespace-nowrap">{connection.publicKey}</code>
                  <button onClick={() => copy(connection.publicKey, "pub")} className="shrink-0 text-xs px-2 py-2 rounded-md border border-slate-200">
                    {copied === "pub" ? "✓" : "Copy"}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Secret key (server-to-server only)</label>
                <div className="flex gap-2">
                  <code className="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-700 overflow-x-auto whitespace-nowrap">
                    {showSecret ? connection.secretKey : "•".repeat(24)}
                  </code>
                  <button onClick={() => setShowSecret((v) => !v)} className="shrink-0 text-xs px-2 py-2 rounded-md border border-slate-200">
                    {showSecret ? "Hide" : "Show"}
                  </button>
                  <button onClick={rotateSecret} className="shrink-0 text-xs px-2 py-2 rounded-md border border-slate-200 text-red-600">
                    Rotate
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Server endpoint: <code className="text-slate-600">{connection.webhookEndpoint}</code> — send with header <code className="text-slate-600">X-Webhook-Secret</code>.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Allowed domains (one per line — leave empty to allow any)</label>
              <textarea
                value={domainsText}
                onChange={(e) => setDomainsText(e.target.value)}
                rows={3}
                placeholder={"example.com\nwww.example.com"}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono"
              />
              <button onClick={saveDomains} disabled={savingDomains} className="mt-2 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-md disabled:opacity-50">
                {savingDomains ? "Saving…" : "Save domains"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Hosted form builder */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Build a hosted form</h2>
        <p className="text-xs text-slate-500">Publishes a shareable page at <code>/f/…</code> — no website required.</p>

        <div className="grid grid-cols-2 gap-3">
          <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Form name (e.g. Contact us)" className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
          <input value={submitText} onChange={(e) => setSubmitText(e.target.value)} placeholder="Submit button text" className="rounded-md border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <input value={successMessage} onChange={(e) => setSuccessMessage(e.target.value)} placeholder="Success message (optional)" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />

        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border border-slate-100 rounded-md p-2">
              <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as FieldType })} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs">
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input value={f.label} onChange={(e) => updateField(i, { label: e.target.value, name: f.name || slugify(e.target.value) })} placeholder="Label" className="flex-1 min-w-[120px] rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
              <input value={f.name} onChange={(e) => updateField(i, { name: slugify(e.target.value) })} placeholder="field_name" className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-mono" />
              {f.type === "dropdown" && (
                <input
                  value={(f.options || []).join(", ")}
                  onChange={(e) => updateField(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                  placeholder="Option A, Option B"
                  className="flex-1 min-w-[120px] rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                />
              )}
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} /> req
              </label>
              <button onClick={() => removeField(i)} className="text-xs text-red-500 px-1">✕</button>
            </div>
          ))}
          <button onClick={addField} className="text-xs font-medium text-blue-600">+ Add field</button>
        </div>

        {builderError && <p className="text-xs text-red-600">{builderError}</p>}
        <button onClick={createForm} disabled={creating} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
          {creating ? "Creating…" : "Create form"}
        </button>
      </section>

      {/* Existing forms */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Your hosted forms</h2>
        {forms.length === 0 ? (
          <p className="text-xs text-slate-400">No hosted forms yet.</p>
        ) : (
          <div className="space-y-2">
            {forms.map((f) => (
              <div key={f.id} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
                <div>
                  <p className="text-sm text-slate-800">{f.name}</p>
                  <p className="text-xs text-slate-400">{(f.fields || []).length} fields · {new Date(f.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <a href={`/f/${f.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Open /f/{f.id.slice(0, 8)}…</a>
                  <button onClick={() => copy(`${window.location.origin}/f/${f.id}`, `link_${f.id}`)} className="text-xs px-2 py-1 rounded-md border border-slate-200">
                    {copied === `link_${f.id}` ? "Copied" : "Copy link"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
