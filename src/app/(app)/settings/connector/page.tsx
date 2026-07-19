"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import ImportHistoricalLeads from "@/components/ImportHistoricalLeads";

type SourceStatus = "connected" | "token_expired" | "permission_revoked" | "not_found" | "error" | "disconnected";

type Source = {
  id: string;
  accountId: string | null;
  platform: string;
  pageId: string | null;
  pageName: string | null;
  businessId: string | null;
  businessName: string | null;
  status: SourceStatus;
  webhookStatus: "active" | "inactive";
  lastError: string | null;
  tokenExpiresAt: string | null;
  webhookSecret: string | null;
  fieldMapping: Record<string, string> | null;
  lastSyncedAt: string | null;
  createdAt: string;
};

type Account = {
  id: string;
  platform: string;
  accountLabel: string | null;
  status: "connected" | "token_expired" | "permission_revoked" | "error" | "disconnected";
};

type ConnectedForm = { id: string; formId: string; formName: string | null; enabled: boolean };

type Business = { id: string; name: string } | null;
type PendingPage = { id: string; name: string; business: Business };
type PendingForm = { id: string; name: string; status: string };

type WebhookLog = {
  id: string;
  status: "success" | "failed" | "retried" | "skipped";
  error: string | null;
  retryCount: number;
  createdAt: string;
  sourceName: string | null;
};

type Health = {
  connectionStatus: string;
  deliveryStatus: "active" | "inactive";
  lastDeliveryReceivedAt: string | null;
  lastLeadReceivedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  totalFormsConnected: number;
  totalLeadsReceived: number;
  leadsToday: number;
  leadsThisWeek: number;
  leadsThisMonth: number;
};

type TestLeadState = { clickedAt: number; status: "polling" | "success" | "failed" };

const ERROR_MESSAGES: Record<string, string> = {
  admin_only: "Only a company admin can connect Meta Lead Ads.",
  missing_code: "Meta didn't return an authorization code. Please try again.",
  invalid_state: "That connection attempt expired. Please try again.",
  no_pages_found: "We didn't find any Facebook Pages you manage on that account.",
  oauth_failed: "Meta couldn't complete the connection. Please try again.",
  source_not_found: "That connection no longer exists.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  facebook_not_configured: "Meta Lead Ads isn't set up yet on this server. Contact your platform administrator.",
};

// No raw Graph API errors or status codes ever reach the customer — this
// is the only vocabulary the UI uses for a connection's health.
const STATUS_META: Record<SourceStatus, { label: string; className: string }> = {
  connected: { label: "Connected", className: "text-emerald-700 bg-emerald-50" },
  token_expired: { label: "Reconnect Required", className: "text-amber-700 bg-amber-50" },
  permission_revoked: { label: "Reconnect Required", className: "text-amber-700 bg-amber-50" },
  not_found: { label: "Page Removed", className: "text-red-700 bg-red-50" },
  error: { label: "Error", className: "text-red-700 bg-red-50" },
  disconnected: { label: "Disconnected", className: "text-slate-500 bg-slate-100" },
};

const NEEDS_RECONNECT: SourceStatus[] = ["token_expired", "permission_revoked"];

function friendlyError(source: Source): string | null {
  if (source.status === "token_expired") return "Facebook access expired for this page. Reconnect to keep receiving leads.";
  if (source.status === "permission_revoked") return "A required permission was removed on Facebook. Reconnect to keep receiving leads.";
  if (source.status === "not_found") return "This Page no longer exists on Facebook. You can safely disconnect it.";
  if (source.status === "error") return "We couldn't reach Facebook for this page. Try Sync Now, or reconnect if it keeps happening.";
  return null;
}

function ConnectorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [sources, setSources] = useState<Source[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);

  // Business -> Page -> Lead Form selection panel state (shown after
  // returning from Facebook Login for Business, or when reconnecting).
  const [pendingPages, setPendingPages] = useState<PendingPage[]>([]);
  const [reconnectSourceId, setReconnectSourceId] = useState<string | null>(null);
  const [existingFormIds, setExistingFormIds] = useState<string[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageForms, setPageForms] = useState<PendingForm[]>([]);
  const [selectedFormIds, setSelectedFormIds] = useState<Set<string>>(new Set());
  const [loadingForms, setLoadingForms] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  const [accountActionId, setAccountActionId] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState("");

  const [detailsOpenAccountId, setDetailsOpenAccountId] = useState<string | null>(null);
  const [detailFormsBySource, setDetailFormsBySource] = useState<Record<string, ConnectedForm[]>>({});
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [togglingFormId, setTogglingFormId] = useState<string | null>(null);

  const [healthByAccount, setHealthByAccount] = useState<Record<string, Health>>({});
  const [testLeadBySource, setTestLeadBySource] = useState<Record<string, TestLeadState>>({});

  const [showGeneric, setShowGeneric] = useState(false);
  const [genericName, setGenericName] = useState("");
  const [genericPlatform, setGenericPlatform] = useState<"generic" | "google">("generic");
  const [submitting, setSubmitting] = useState(false);
  const [newSource, setNewSource] = useState<{ id: string; webhookSecret: string; webhookUrl: string } | null>(null);

  const [showWebsite, setShowWebsite] = useState(false);
  const [websiteName, setWebsiteName] = useState("");
  const [newWebsiteForm, setNewWebsiteForm] = useState<{ id: string; name: string } | null>(null);

  const oauthError = searchParams.get("error");
  const justConnected = searchParams.get("connected");
  const justReconnected = searchParams.get("reconnected");
  const refreshedCount = searchParams.get("refreshed");

  async function load() {
    const [sourcesRes, pendingRes, logsRes] = await Promise.all([
      fetch("/api/lead-sources"),
      fetch("/api/lead-sources/facebook/pending"),
      fetch("/api/webhook-logs"),
    ]);
    const sourcesData = await sourcesRes.json();
    const loadedAccounts: Account[] = sourcesData.accounts || [];
    setSources(sourcesData.sources || []);
    setAccounts(loadedAccounts);
    const pending = await pendingRes.json();
    setPendingPages(pending.pages || []);
    setReconnectSourceId(pending.reconnectSourceId || null);
    setExistingFormIds(pending.existingFormIds || []);
    setLogs((await logsRes.json()).logs || []);

    if (loadedAccounts.length > 0) {
      const healthResults = await Promise.all(
        loadedAccounts.map((a) => fetch(`/api/lead-sources/accounts/${a.id}/health`).then((r) => r.json()))
      );
      const byAccount: Record<string, Health> = {};
      loadedAccounts.forEach((a, i) => {
        byAccount[a.id] = healthResults[i];
      });
      setHealthByAccount(byAccount);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickPage(pageId: string) {
    setSelectedPageId(pageId);
    setPageForms([]);
    setConnectError("");
    setLoadingForms(true);
    const res = await fetch(`/api/lead-sources/facebook/forms?pageId=${encodeURIComponent(pageId)}`);
    const data = await res.json();
    setLoadingForms(false);
    if (!res.ok) {
      setConnectError(data.error || "Could not load lead forms for this page.");
      return;
    }
    const forms: PendingForm[] = data.forms || [];
    setPageForms(forms);
    // Reconnecting: keep whatever was already enabled. Fresh connect: tick
    // every form by default — one click, nothing to configure, matching
    // how simple this needs to feel.
    const defaultChecked =
      reconnectSourceId && existingFormIds.length > 0
        ? forms.filter((f) => existingFormIds.includes(f.id)).map((f) => f.id)
        : forms.map((f) => f.id);
    setSelectedFormIds(new Set(defaultChecked));
  }

  function toggleForm(formId: string) {
    setSelectedFormIds((prev) => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId);
      else next.add(formId);
      return next;
    });
  }

  async function connectSelectedPage() {
    if (!selectedPageId) return;
    setConnecting(true);
    setConnectError("");
    const forms = pageForms.filter((f) => selectedFormIds.has(f.id)).map((f) => ({ id: f.id, name: f.name }));
    const res = await fetch("/api/lead-sources/facebook/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: selectedPageId, forms }),
    });
    const data = await res.json();
    setConnecting(false);
    if (!res.ok) {
      setConnectError(data.error || "Something went wrong");
      return;
    }
    setSelectedPageId(null);
    setPageForms([]);
    router.replace("/settings/connector");
    load();
  }

  async function disconnectAccount(account: Account) {
    if (!confirm(`Disconnect ${account.accountLabel || "this Meta account"}? All of its Pages stop sending leads. Leads already captured stay intact.`)) return;
    setAccountActionId(account.id);
    await fetch(`/api/lead-sources/accounts/${account.id}`, { method: "DELETE" });
    setAccountActionId(null);
    load();
  }

  async function syncAccount(account: Account) {
    setAccountActionId(account.id);
    setAccountMessage("");
    const res = await fetch(`/api/lead-sources/accounts/${account.id}/sync`, { method: "POST" });
    const data = await res.json();
    setAccountActionId(null);
    if (!res.ok) {
      setAccountMessage(data.error || "Sync failed.");
    } else {
      setAccountMessage(
        data.newFormsFound > 0
          ? `Found ${data.newFormsFound} new form(s) across ${data.pagesSynced} page(s).`
          : `${data.pagesSynced} page(s) up to date.`
      );
    }
    load();
  }

  function reconnectAccount(account: Account) {
    window.location.href = `/api/oauth/facebook/start?reconnectAccount=${account.id}`;
  }

  async function toggleAccountDetails(account: Account) {
    if (detailsOpenAccountId === account.id) {
      setDetailsOpenAccountId(null);
      return;
    }
    setDetailsOpenAccountId(account.id);
    setLoadingDetails(true);
    const pagesInAccount = sources.filter((s) => s.accountId === account.id);
    const results = await Promise.all(
      pagesInAccount.map((s) => fetch(`/api/lead-sources/${s.id}`).then((r) => r.json()))
    );
    setLoadingDetails(false);
    const bySource: Record<string, ConnectedForm[]> = {};
    pagesInAccount.forEach((s, i) => {
      bySource[s.id] = results[i]?.forms || [];
    });
    setDetailFormsBySource(bySource);
  }

  async function toggleFormEnabled(source: Source, form: ConnectedForm) {
    setTogglingFormId(form.id);
    const res = await fetch(`/api/lead-sources/${source.id}/forms/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !form.enabled }),
    });
    setTogglingFormId(null);
    if (res.ok) {
      setDetailFormsBySource((prev) => ({
        ...prev,
        [source.id]: (prev[source.id] || []).map((f) => (f.id === form.id ? { ...f, enabled: !f.enabled } : f)),
      }));
    }
  }

  async function disconnectSource(source: Source) {
    if (!confirm(`Disconnect ${source.pageName || "this Page"}? Leads already captured stay intact.`)) return;
    await fetch(`/api/lead-sources/${source.id}`, { method: "DELETE" });
    load();
  }

  async function syncNow(source: Source) {
    setAccountActionId(source.id);
    const res = await fetch(`/api/lead-sources/${source.id}/sync`, { method: "POST" });
    const data = await res.json();
    setAccountActionId(null);
    setAccountMessage(res.ok ? (data.newFormsFound > 0 ? `Found ${data.newFormsFound} new form(s).` : "Up to date.") : data.error || "Sync failed.");
    load();
  }

  function reconnectSource(source: Source) {
    window.location.href = `/api/oauth/facebook/start?reconnect=${source.id}`;
  }

  // Opens Meta's own Lead Ads Testing Tool in a new tab, then polls this
  // source for a lead created after the button was clicked — that's the
  // only reliable way to confirm end-to-end delivery (webhook subscription
  // + Graph API access + assignment) actually works, short of waiting for
  // a real customer lead.
  function startTestLead(source: Source) {
    const clickedAt = Date.now();
    setTestLeadBySource((prev) => ({ ...prev, [source.id]: { clickedAt, status: "polling" } }));
    window.open("https://developers.facebook.com/tools/lead-ads-testing/", "_blank", "noopener,noreferrer");

    const sinceIso = new Date(clickedAt).toISOString();
    const deadline = clickedAt + 90_000;
    const poll = async () => {
      const res = await fetch(`/api/lead-sources/${source.id}/latest-lead?since=${encodeURIComponent(sinceIso)}`);
      const data = await res.json();
      if (data.found) {
        setTestLeadBySource((prev) => ({ ...prev, [source.id]: { clickedAt, status: "success" } }));
        return;
      }
      if (Date.now() >= deadline) {
        setTestLeadBySource((prev) => ({ ...prev, [source.id]: { clickedAt, status: "failed" } }));
        return;
      }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 3000);
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

  async function createWebsiteForm() {
    setSubmitting(true);
    const res = await fetch("/api/lead-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "website", name: websiteName || undefined }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      setNewWebsiteForm({ id: data.source.id, name: data.source.pageName });
      setWebsiteName("");
      load();
    }
  }

  async function retryLog(id: string) {
    await fetch(`/api/webhook-logs/${id}/retry`, { method: "POST" });
    load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // Sources with no accountId (Universal Webhook) render as a flat list,
  // unchanged. Every OAuth-based source belongs to exactly one connected
  // account — see accountId in db/schema.ts — so grouping by it is what
  // produces the "Meta Account -> Business -> Pages" hierarchy.
  const otherSources = sources.filter((s) => !s.accountId);

  // Group the pending page list by Business for the selection panel.
  const businessGroups = new Map<string, { business: Business; pages: PendingPage[] }>();
  for (const p of pendingPages) {
    const key = p.business?.id || "ungrouped";
    if (!businessGroups.has(key)) businessGroups.set(key, { business: p.business, pages: [] });
    businessGroups.get(key)!.pages.push(p);
  }

  // Group connected Pages by their account, then by Business within it —
  // the exact "Meta Account -> Business -> Pages" nesting the Lead Sources
  // page displays. `accounts` from the API already excludes disconnected
  // (soft-deleted) accounts, so every entry here is a live connection.
  const accountBlocks = accounts.map((account) => {
    const accountSources = sources.filter((s) => s.accountId === account.id);
    const byBusiness = new Map<string, { business: string | null; pages: Source[] }>();
    for (const s of accountSources) {
      const key = s.businessId || "ungrouped";
      if (!byBusiness.has(key)) byBusiness.set(key, { business: s.businessName, pages: [] });
      byBusiness.get(key)!.pages.push(s);
    }
    return { account, businesses: [...byBusiness.values()] };
  });

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Lead Sources</h1>
      <p className="text-sm text-slate-500 mb-6">Connect where your leads come from. Once connected, they flow in automatically.</p>

      {oauthError && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-700 text-sm rounded-lg p-3">
          {ERROR_MESSAGES[oauthError] || "Something went wrong connecting Meta."}
        </div>
      )}
      {justReconnected && (
        <div className="mb-6 bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-lg p-3">
          Account reconnected — {refreshedCount || 0} page{refreshedCount === "1" ? "" : "s"} refreshed.
        </div>
      )}

      {/* Source cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            <span className="text-sm font-semibold text-slate-900">Meta Lead Ads</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">Facebook & Instagram Lead Ads, connected with one click.</p>
          <a
            href="/api/oauth/facebook/start"
            className="inline-flex items-center justify-center bg-[#1877F2] text-white text-xs font-medium px-3 py-2 rounded-md hover:bg-[#166fe0] transition-colors"
          >
            {accountBlocks.length > 0 ? "Connect another Account" : "Connect Meta"}
          </a>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-900">Website Forms</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">Paste one snippet on any site — every form submission becomes a lead.</p>
          <button
            onClick={() => setShowWebsite((v) => !v)}
            className="text-xs font-medium text-white bg-slate-900 rounded-md px-3 py-2 hover:bg-slate-800"
          >
            {showWebsite ? "Hide" : "Add a Website Form"}
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-900">Custom Integration</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">For Google Lead Forms (via Zapier/Pabbly), custom forms, or another CRM.</p>
          <button
            onClick={() => setShowGeneric((v) => !v)}
            className="text-xs font-medium text-slate-700 bg-slate-100 rounded-md px-3 py-2 hover:bg-slate-200"
          >
            {showGeneric ? "Hide" : "Add a Connection"}
          </button>
        </div>

        {[
          "Google Ads Lead Forms",
          "TikTok",
          "LinkedIn",
          "Typeform",
          "Jotform",
          "Gravity Forms",
          "WordPress",
        ].map((name) => (
          <div key={name} className="bg-white border border-slate-200 rounded-lg p-4 opacity-60">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-slate-900">{name}</span>
              <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 shrink-0">Coming Soon</span>
            </div>
            <p className="text-xs text-slate-500">Automatic lead capture from {name}.</p>
          </div>
        ))}
      </div>

      {/* Business -> Page -> Form selection panel */}
      {(justConnected || reconnectSourceId) && pendingPages.length > 0 && (
        <div className="mb-8 bg-blue-50 border border-blue-100 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-blue-900 mb-1">
            {reconnectSourceId ? "Reconnect Meta Lead Ads" : "Choose what to connect"}
          </h2>
          <p className="text-xs text-blue-800 mb-3">Select a Page, then tick which Lead Forms should send leads into Pipeline.</p>

          <div className="space-y-3">
            {[...businessGroups.entries()].map(([key, group]) => (
              <div key={key} className="bg-white rounded-md border border-blue-100">
                <div className="px-3 py-2 text-xs font-semibold text-slate-500 border-b border-slate-100">
                  {group.business?.name || "Pages"}
                </div>
                <div className="divide-y divide-slate-100">
                  {group.pages.map((p) => (
                    <div key={p.id}>
                      <button
                        onClick={() => pickPage(p.id)}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                          selectedPageId === p.id ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-800 hover:bg-slate-50"
                        }`}
                      >
                        {p.name}
                        <span className="text-xs text-slate-400">{selectedPageId === p.id ? "Selected" : "Select"}</span>
                      </button>
                      {selectedPageId === p.id && (
                        <div className="px-3 pb-3">
                          {loadingForms && <div className="text-xs text-slate-400 py-2">Loading lead forms…</div>}
                          {!loadingForms && pageForms.length === 0 && (
                            <div className="text-xs text-slate-400 py-2">No Lead Ad forms found on this Page yet.</div>
                          )}
                          {!loadingForms && pageForms.length > 0 && (
                            <div className="space-y-1.5 py-2">
                              {pageForms.map((f) => (
                                <label key={f.id} className="flex items-center gap-2 text-xs text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={selectedFormIds.has(f.id)}
                                    onChange={() => toggleForm(f.id)}
                                    className="rounded border-slate-300"
                                  />
                                  {f.name}
                                </label>
                              ))}
                            </div>
                          )}
                          {connectError && <p className="text-xs text-red-600 mb-2">{connectError}</p>}
                          <button
                            onClick={connectSelectedPage}
                            disabled={connecting || loadingForms}
                            className="text-xs font-medium text-white bg-blue-600 rounded-md px-3 py-1.5 disabled:opacity-50"
                          >
                            {connecting ? "Connecting…" : "Connect"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showWebsite && (
        <div className="mb-8 bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500 mb-3">
            Create a form connection, then paste the snippet on any site (WordPress, Shopify, Webflow, plain HTML,
            React, anything). Every submission of a tagged form becomes a lead and enters assignment automatically —
            with spam protection built in.
          </p>
          <div className="flex gap-2 mb-3">
            <input
              value={websiteName}
              onChange={(e) => setWebsiteName(e.target.value)}
              placeholder="Form name (e.g. Homepage Contact)"
              className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              onClick={createWebsiteForm}
              disabled={submitting}
              className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40"
            >
              Create
            </button>
          </div>
          {newWebsiteForm && (
            <div className="bg-blue-50 border border-blue-100 rounded-md p-3 text-xs text-blue-900 space-y-2">
              <div className="font-semibold">“{newWebsiteForm.name}” is ready. Paste this on your site:</div>
              <div>
                <div className="text-[11px] text-blue-800 mb-0.5">1. Add the loader once (before &lt;/body&gt;):</div>
                <pre className="bg-white rounded p-2 overflow-x-auto font-mono text-[11px]">{`<script src="${origin}/embed.js"></script>`}</pre>
              </div>
              <div>
                <div className="text-[11px] text-blue-800 mb-0.5">2. Tag your form with this ID:</div>
                <pre className="bg-white rounded p-2 overflow-x-auto font-mono text-[11px]">{`<form data-ziplod-form="${newWebsiteForm.id}">
  <input name="name" placeholder="Name" />
  <input name="email" type="email" placeholder="Email" />
  <input name="phone" placeholder="Phone" />
  <button type="submit">Send</button>
</form>`}</pre>
              </div>
              <div className="text-[11px] text-blue-800">
                Prefer no JavaScript? Point your form at{" "}
                <span className="font-mono break-all">{origin}/api/forms/{newWebsiteForm.id}</span> with a POST. The
                loader also captures UTM tags, referrer, landing page, device, and timezone automatically.
              </div>
            </div>
          )}
        </div>
      )}

      {showGeneric && (
        <div className="mb-8 bg-white border border-slate-200 rounded-lg p-4">
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
              <option value="generic">Generic Connection</option>
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
                <strong>Connection URL:</strong> <span className="font-mono break-all">{origin}{newSource.webhookUrl}</span>
              </div>
              <div>
                <strong>Header required:</strong> <span className="font-mono">X-Webhook-Secret: {newSource.webhookSecret}</span>
              </div>
              <div>Save this secret now — it won&apos;t be shown again in full.</div>
            </div>
          )}
        </div>
      )}

      {/* Connected sources */}
      <h2 className="text-sm font-semibold text-slate-700 mb-3">Connected Sources</h2>

      {accountBlocks.length === 0 && otherSources.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 text-sm text-slate-400 mb-8">No sources connected yet.</div>
      )}

      {/* One block per connected Meta account — Business -> Pages nested inside */}
      <div className="space-y-3 mb-3">
        {accountBlocks.map(({ account, businesses }) => {
          const unhealthyCount = sources.filter((s) => s.accountId === account.id && s.status !== "connected").length;
          const isOpen = detailsOpenAccountId === account.id;
          const busy = accountActionId === account.id;
          return (
            <div key={account.id} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Meta Account</div>
                  <div className="text-sm font-medium text-slate-900 break-all">{account.accountLabel || "Connected account"}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`text-xs font-medium rounded-full px-2.5 py-1 ${
                        account.status === "connected" ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"
                      }`}
                    >
                      {account.status === "connected" ? "Connected" : "Disconnected"}
                    </span>
                    {unhealthyCount > 0 && (
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2.5 py-1">
                        {unhealthyCount} page{unhealthyCount > 1 ? "s" : ""} need attention
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleAccountDetails(account)}
                    className="text-xs font-medium text-slate-600 bg-slate-100 rounded-md px-2.5 py-1.5 hover:bg-slate-200"
                  >
                    {isOpen ? "Hide Details" : "View Details"}
                  </button>
                  <button
                    onClick={() => reconnectAccount(account)}
                    className="text-xs font-medium text-white bg-slate-900 rounded-md px-2.5 py-1.5 hover:bg-slate-800"
                  >
                    Reconnect
                  </button>
                  <button
                    onClick={() => disconnectAccount(account)}
                    disabled={busy}
                    className="text-xs font-medium text-red-600 bg-red-50 rounded-md px-2.5 py-1.5 hover:bg-red-100 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                  <button
                    onClick={() => syncAccount(account)}
                    disabled={busy}
                    className="text-xs font-medium text-slate-600 bg-slate-100 rounded-md px-2.5 py-1.5 hover:bg-slate-200 disabled:opacity-50"
                  >
                    {busy ? "Syncing…" : "Sync"}
                  </button>
                </div>
              </div>

              {businesses.map((group, i) => (
                <div key={group.business || i} className="mb-2 last:mb-0">
                  <div className="text-xs text-slate-500 mb-1">Business: {group.business || "—"}</div>
                  <div className="space-y-1">
                    {group.pages.map((p) => (
                      <div key={p.id} className="text-sm text-slate-700 flex items-center gap-1.5 pl-2">
                        {p.status === "connected" ? (
                          <span className="text-emerald-600">✓</span>
                        ) : (
                          <span className="text-amber-500">!</span>
                        )}
                        {p.pageName}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {(() => {
                const health = healthByAccount[account.id];
                if (!health) return null;
                const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "Never");
                const stat = (label: string, value: React.ReactNode) => (
                  <div>
                    <dt className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</dt>
                    <dd className="text-xs font-medium text-slate-800 mt-0.5">{value}</dd>
                  </div>
                );
                return (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                      Lead Delivery Health
                    </div>
                    <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
                      {stat("Connection", health.connectionStatus === "connected" ? "Connected" : "Disconnected")}
                      {stat("Delivery", health.deliveryStatus === "active" ? "Active" : "Inactive")}
                      {stat("Last delivery received", fmt(health.lastDeliveryReceivedAt))}
                      {stat("Last lead received", fmt(health.lastLeadReceivedAt))}
                      {stat("Last successful sync", fmt(health.lastSuccessfulSyncAt))}
                      {stat("Forms connected", health.totalFormsConnected)}
                      {stat("Total leads received", health.totalLeadsReceived)}
                      {stat("Leads today", health.leadsToday)}
                      {stat("Leads this week", health.leadsThisWeek)}
                      {stat("Leads this month", health.leadsThisMonth)}
                    </dl>
                  </div>
                );
              })()}

              {isOpen && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                  {loadingDetails && <div className="text-xs text-slate-400">Loading…</div>}
                  {!loadingDetails &&
                    sources
                      .filter((s) => s.accountId === account.id)
                      .map((s) => {
                        const err = friendlyError(s);
                        return (
                          <div key={s.id} className="bg-slate-50 rounded-md p-3">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="text-xs font-semibold text-slate-700">{s.pageName}</span>
                              <div className="flex items-center gap-1.5">
                                {NEEDS_RECONNECT.includes(s.status) && (
                                  <button
                                    onClick={() => reconnectSource(s)}
                                    className="text-[11px] font-medium text-white bg-slate-900 rounded px-2 py-1"
                                  >
                                    Reconnect this Page
                                  </button>
                                )}
                                <button onClick={() => syncNow(s)} className="text-[11px] font-medium text-slate-600 bg-slate-200 rounded px-2 py-1">
                                  Sync
                                </button>
                                <button
                                  onClick={() => startTestLead(s)}
                                  disabled={testLeadBySource[s.id]?.status === "polling"}
                                  className="text-[11px] font-medium text-blue-700 bg-blue-50 rounded px-2 py-1 disabled:opacity-50"
                                >
                                  {testLeadBySource[s.id]?.status === "polling" ? "Waiting for test lead…" : "Test Lead"}
                                </button>
                                <button
                                  onClick={() => disconnectSource(s)}
                                  className="text-[11px] font-medium text-red-600 bg-red-50 rounded px-2 py-1"
                                >
                                  Disconnect this Page
                                </button>
                              </div>
                            </div>
                            {err && <p className="text-xs text-amber-600 mb-2">{err}</p>}
                            {testLeadBySource[s.id] && (
                              <div
                                className={`text-xs rounded-md p-2 mb-2 ${
                                  testLeadBySource[s.id].status === "success"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : testLeadBySource[s.id].status === "failed"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-blue-50 text-blue-700"
                                }`}
                              >
                                {testLeadBySource[s.id].status === "polling" && (
                                  <>
                                    A new tab opened to Meta&apos;s Lead Ads Testing Tool. Select <strong>{s.pageName}</strong> and
                                    any form, then click &quot;Send Test Lead&quot; there — we&apos;re checking for it every few
                                    seconds.
                                  </>
                                )}
                                {testLeadBySource[s.id].status === "success" && <>✓ Test lead received successfully.</>}
                                {testLeadBySource[s.id].status === "failed" && (
                                  <>❌ Test failed — no lead arrived within 90 seconds. Check that the form was submitted for this Page and that the connection is healthy above.</>
                                )}
                              </div>
                            )}
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                              <dt className="text-slate-400">Delivery</dt>
                              <dd className="text-slate-700">
                                <span
                                  className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                                    s.webhookStatus === "active" ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"
                                  }`}
                                >
                                  {s.webhookStatus === "active" ? "Active" : "Inactive"}
                                </span>
                              </dd>
                              <dt className="text-slate-400">Access expires</dt>
                              <dd className="text-slate-700">
                                {s.tokenExpiresAt ? new Date(s.tokenExpiresAt).toLocaleDateString() : "Doesn't expire"}
                              </dd>
                            </dl>
                            {/* Above the form list on purpose: a Page with a lot
                                of forms pushes anything below it off-screen, and
                                importing is a thing you come here to DO, whereas
                                the form checkboxes are set once and forgotten. */}
                            <ImportHistoricalLeads sourceId={s.id} pageName={s.pageName || "this Page"} />
                            <div className="text-xs font-semibold text-slate-500 mt-3 mb-1">Lead Forms</div>
                            {(detailFormsBySource[s.id] || []).length === 0 && (
                              <div className="text-xs text-slate-400">No forms connected.</div>
                            )}
                            <div className="space-y-1">
                              {(detailFormsBySource[s.id] || []).map((f) => (
                                <label key={f.id} className="flex items-center gap-2 text-xs text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={f.enabled}
                                    disabled={togglingFormId === f.id}
                                    onChange={() => toggleFormEnabled(s, f)}
                                    className="rounded border-slate-300"
                                  />
                                  {f.formName || f.formId}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {accountMessage && <p className="text-xs text-slate-500 mb-8">{accountMessage}</p>}

      {/* Custom Integration sources — no account grouping, unchanged from before accounts existed */}
      {otherSources.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-8">
          {otherSources.map((s) => (
            <div key={s.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">{s.pageName || "Unknown source"}</div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {s.platform === "google" ? "Google Lead Forms" : "Custom Integration"}
                  {" · "}
                  {s.lastSyncedAt ? `Last sync ${new Date(s.lastSyncedAt).toLocaleString()}` : "No leads yet"}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${(STATUS_META[s.status] || STATUS_META.connected).className}`}>
                  {(STATUS_META[s.status] || STATUS_META.connected).label}
                </span>
                <button
                  onClick={() => disconnectSource(s)}
                  className="text-xs font-medium text-red-600 bg-red-50 rounded-md px-2.5 py-1.5 hover:bg-red-100"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">Delivery Log</h2>
        <Link href="/settings/delivery-log" className="text-xs font-medium text-blue-600">
          View full log →
        </Link>
      </div>
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
