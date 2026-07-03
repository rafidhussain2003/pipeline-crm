"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type Source = {
  id: string;
  platform: string;
  pageId: string | null;
  pageName: string | null;
  status: string;
  webhookSecret: string | null;
  lastSyncedAt: string | null;
};

type PendingPage = { id: string; name: string };

type WebhookLog = {
  id: string;
  status: "success" | "failed" | "retried";
  error: string | null;
  retryCount: number;
  createdAt: string;
  sourceName: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  admin_only: "Only a company admin can connect Facebook pages.",
  missing_code: "Facebook didn't return an authorization code. Please try again.",
  invalid_state: "That connection attempt expired. Please try again.",
  no_pages_found: "We didn't find any Facebook Pages you manage on that account.",
  oauth_failed: "Facebook couldn't complete the connection. Please try again.",
};

function ConnectorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [pendingPages, setPendingPages] = useState<PendingPage[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [showGeneric, setShowGeneric] = useState(false);
  const [genericName, setGenericName] = useState("");
  const [genericPlatform, setGenericPlatform] = useState<"generic" | "google">("generic");
  const [newSource, setNewSource] = useState<{ id: string; webhookSecret: string; webhookUrl: string } | null>(null);

  const oauthError = searchParams.get("error");
  const justConnected = searchParams.get("connected");

  async function load() {
    const [sourcesRes, pendingRes, logsRes] = await Promise.all([
      fetch("/api/lead-sources"),
      fetch("/api/lead-sources/facebook/pending"),
      fetch("/api/webhook-logs"),
    ]);
    setSources((await sourcesRes.json()).sources || []);
    setPendingPages((await pendingRes.json()).pages || []);
    setLogs((await logsRes.json()).logs || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function connectPage(pageId: string) {
    setConnectingId(pageId);
    const res = await fetch("/api/lead-sources/facebook/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId }),
    });
    setConnectingId(null);
    if (res.ok) {
      load();
      router.replace("/settings/connector");
    }
  }

  async function connectManualToken() {
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/lead-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, platform: "facebook" }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    setToken("");
    load();
  }

  async function createGenericSource() {
    setSubmitting(true);
    const res = await fetch("/api/lead-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: genericPlatform, name: genericName || undefined }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setNewSource(data.source);
      setGenericName("");
      load();
    }
  }

  async function retryLog(id: string) {
    await fetch(`/api/webhook-logs/${id}/retry`, { method: "POST" });
    load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Connect Facebook</h1>
      <p className="text-sm text-slate-500 mb-6">
        Connect the same way you would with HubSpot or any other tool — sign in with Facebook, pick your pages, and
        leads start flowing in automatically. No tokens to copy.
      </p>

      {oauthError && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-700 text-sm rounded-lg p-3">
          {ERROR_MESSAGES[oauthError] || "Something went wrong connecting Facebook."}
        </div>
      )}

      {justConnected && pendingPages.length > 0 && (
        <div className="mb-6 bg-blue-50 border border-blue-100 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-blue-900 mb-3">Choose which pages to connect</h2>
          <div className="space-y-2">
            {pendingPages.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-white rounded-md border border-blue-100 px-3 py-2">
                <span className="text-sm font-medium text-slate-900">{p.name}</span>
                <button
                  onClick={() => connectPage(p.id)}
                  disabled={connectingId === p.id}
                  className="text-xs font-medium text-white bg-blue-600 rounded-md px-3 py-1.5 disabled:opacity-50"
                >
                  {connectingId === p.id ? "Connecting…" : "Connect"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <a
        href="/api/oauth/facebook/start"
        className="inline-flex items-center gap-2 bg-[#1877F2] text-white text-sm font-medium px-4 py-2.5 rounded-md hover:bg-[#166fe0] transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
        Connect with Facebook
      </a>

      <h2 className="text-sm font-semibold text-slate-700 mt-8 mb-3">Connected sources</h2>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {sources.length === 0 && <div className="p-4 text-sm text-slate-400">No sources connected yet.</div>}
        {sources.map((s) => (
          <div key={s.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-900">{s.pageName || s.pageId || "Unknown source"}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {s.platform} · {s.lastSyncedAt ? `Last lead ${new Date(s.lastSyncedAt).toLocaleString()}` : "No leads yet"}
              </div>
            </div>
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 rounded-full px-2.5 py-1">{s.status}</span>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <button
          onClick={() => setShowGeneric((v) => !v)}
          className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-2"
        >
          {showGeneric ? "Hide" : "+ Add a Universal Webhook (Google Lead Forms, custom forms, other tools)"}
        </button>
        {showGeneric && (
          <div className="mt-3 bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-3">
              Creates a webhook URL that any tool (Google Lead Forms via a relay like Zapier, a custom form builder,
              another CRM) can POST leads to. It expects JSON with <code>name</code>, <code>phone</code>,{" "}
              <code>email</code> fields by default — the field mapping can be customized later via the API if your
              tool sends a different shape.
            </p>
            <div className="flex gap-2 mb-3">
              <select
                value={genericPlatform}
                onChange={(e) => setGenericPlatform(e.target.value as "generic" | "google")}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="generic">Generic Webhook</option>
                <option value="google">Google Lead Forms</option>
              </select>
              <input
                value={genericName}
                onChange={(e) => setGenericName(e.target.value)}
                placeholder="Name (optional)"
                className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                onClick={createGenericSource}
                disabled={submitting}
                className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40"
              >
                Create
              </button>
            </div>
            {newSource && (
              <div className="bg-blue-50 border border-blue-100 rounded-md p-3 text-xs text-blue-900 space-y-1">
                <div>
                  <strong>Webhook URL:</strong>{" "}
                  <span className="font-mono break-all">{origin}{newSource.webhookUrl}</span>
                </div>
                <div>
                  <strong>Header required:</strong> <span className="font-mono">X-Webhook-Secret: {newSource.webhookSecret}</span>
                </div>
                <div>Save this secret now — it won&apos;t be shown again in full.</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-8">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs font-medium text-slate-400 hover:text-slate-600"
        >
          {showAdvanced ? "Hide" : "Advanced: connect Facebook with a page access token instead"}
        </button>
        {showAdvanced && (
          <div className="mt-3 bg-white border border-slate-200 rounded-lg p-4">
            <label className="block text-sm font-medium text-slate-700 mb-2">Page access token</label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              placeholder="EAAG..."
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            <button
              onClick={connectManualToken}
              disabled={!token || submitting}
              className="mt-3 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40"
            >
              {submitting ? "Connecting…" : "Connect Page"}
            </button>
          </div>
        )}
      </div>

      <h2 className="text-sm font-semibold text-slate-700 mt-8 mb-3">Webhook delivery log</h2>
      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {logs.length === 0 && <div className="p-4 text-sm text-slate-400">No deliveries yet.</div>}
        {logs.map((log) => (
          <div key={log.id} className="p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-slate-800">
                {log.sourceName || "Unknown source"}{" "}
                <span
                  className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ml-1 ${
                    log.status === "success"
                      ? "text-emerald-700 bg-emerald-50"
                      : log.status === "retried"
                      ? "text-blue-700 bg-blue-50"
                      : "text-red-700 bg-red-50"
                  }`}
                >
                  {log.status.toUpperCase()}
                </span>
              </div>
              {log.error && <div className="text-xs text-red-500 truncate">{log.error}</div>}
              <div className="text-xs text-slate-400">{new Date(log.createdAt).toLocaleString()}</div>
            </div>
            {log.status === "failed" && (
              <button onClick={() => retryLog(log.id)} className="text-xs font-medium text-white bg-slate-900 rounded-md px-3 py-1.5 shrink-0">
                Retry
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ConnectorPage() {
  return (
    <Suspense>
      <ConnectorContent />
    </Suspense>
  );
}
