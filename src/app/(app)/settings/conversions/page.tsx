"use client";

import { useEffect, useState } from "react";

type Account = { id: string; label: string | null; status: string; hasToken: boolean };
type IdName = { id: string; name: string };
type Pixel = { id: string; businessName: string | null; adAccountName: string | null; pixelId: string; pixelName: string | null; testEventCode: string | null; active: boolean; hasToken: boolean };
type Mapping = { trigger: string; label: string; kind: "system" | "disposition"; metaEvent: string | null; enabled: boolean };
type Diagnostics = {
  pixelConnected: boolean; datasetConnected: boolean; oauth: { status: string; hasToken: boolean; tokenExpiresAt: string | null; accountLabel: string | null };
  permissions: string; events24h: number; successRate: number | null; failureRate: number | null; avgLatencyMs: number | null; eventMatchQuality: string;
  recentEvents: { eventName: string; status: string; emq: string | null; createdAt: string }[];
};
type LogEvent = { id: string; eventName: string; status: string; trigger: string | null; leadName: string | null; leadId: string | null; pixelName: string | null; pixelId: string | null; httpStatus: number | null; latencyMs: number | null; attempts: number; eventMatchQuality: string | null; metaResponse: unknown; lastError: string | null; origin: string; createdAt: string };

const EMQ_COLOR: Record<string, string> = { excellent: "text-green-700 bg-green-50", good: "text-blue-700 bg-blue-50", fair: "text-amber-700 bg-amber-50", poor: "text-red-700 bg-red-50" };
const STATUS_COLOR: Record<string, string> = { sent: "text-green-700 bg-green-50", pending: "text-slate-600 bg-slate-100", processing: "text-blue-700 bg-blue-50", failed: "text-amber-700 bg-amber-50", dead_letter: "text-red-700 bg-red-50" };

export default function ConversionsPage() {
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [metaEvents, setMetaEvents] = useState<string[]>([]);

  // Connect flow state
  const [acctId, setAcctId] = useState("");
  const [businesses, setBusinesses] = useState<IdName[]>([]);
  const [bizId, setBizId] = useState("");
  const [adAccounts, setAdAccounts] = useState<IdName[]>([]);
  const [adAcctId, setAdAcctId] = useState("");
  const [pixelChoices, setPixelChoices] = useState<IdName[]>([]);
  const [chosenPixel, setChosenPixel] = useState("");
  const [testCode, setTestCode] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const [editing, setEditing] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);

  async function load() {
    const [a, p, d, e] = await Promise.all([fetch("/api/capi/accounts"), fetch("/api/capi/pixels"), fetch("/api/capi/diagnostics"), fetch("/api/capi/events")]);
    setAccounts((await a.json()).accounts || []);
    setPixels((await p.json()).pixels || []);
    setDiag((await d.json()).diagnostics || null);
    setEvents((await e.json()).events || []);
    setLoaded(true);
  }
  useEffect(() => { load(); }, []);

  async function pickAccount(id: string) {
    setAcctId(id); setBizId(""); setAdAcctId(""); setChosenPixel(""); setBusinesses([]); setAdAccounts([]); setPixelChoices([]);
    if (!id) return;
    setBusy("Loading businesses…"); setMsg("");
    const r = await fetch(`/api/capi/discover?accountId=${id}`);
    const j = await r.json();
    setBusy("");
    if (!r.ok) return setMsg(j.error || "Could not load businesses.");
    setBusinesses(j.businesses || []);
  }
  async function pickBusiness(id: string) {
    setBizId(id); setAdAcctId(""); setChosenPixel(""); setAdAccounts([]); setPixelChoices([]);
    setBusy("Loading ad accounts…");
    const r = await fetch(`/api/capi/discover?accountId=${acctId}&businessId=${id}`);
    const j = await r.json(); setBusy("");
    if (!r.ok) return setMsg(j.error || "Could not load ad accounts.");
    setAdAccounts(j.adAccounts || []);
  }
  async function pickAdAccount(id: string) {
    setAdAcctId(id); setChosenPixel(""); setPixelChoices([]);
    setBusy("Loading pixels…");
    const r = await fetch(`/api/capi/discover?accountId=${acctId}&adAccountId=${id}`);
    const j = await r.json(); setBusy("");
    if (!r.ok) return setMsg(j.error || "Could not load pixels.");
    setPixelChoices(j.pixels || []);
  }
  async function connectPixel() {
    if (!chosenPixel) return;
    const pixel = pixelChoices.find((p) => p.id === chosenPixel);
    const biz = businesses.find((b) => b.id === bizId);
    const adAcct = adAccounts.find((a) => a.id === adAcctId);
    setBusy("Connecting…");
    const r = await fetch("/api/capi/pixels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: acctId, businessId: bizId, businessName: biz?.name, adAccountId: adAcctId, adAccountName: adAcct?.name, pixelId: pixel?.id, pixelName: pixel?.name, datasetId: pixel?.id, testEventCode: testCode || null }),
    });
    setBusy("");
    if (!r.ok) { const j = await r.json(); return setMsg(j.error || "Could not connect."); }
    setAcctId(""); setBusinesses([]); setAdAccounts([]); setPixelChoices([]); setChosenPixel(""); setTestCode("");
    setMsg("Pixel connected. Default event mapping was created — review it below.");
    load();
  }
  async function removePixel(id: string) {
    if (!confirm("Disconnect this pixel? Conversion sending for it will stop.")) return;
    await fetch(`/api/capi/pixels/${id}`, { method: "DELETE" });
    load();
  }
  async function openMapping(pixelId: string) {
    if (editing === pixelId) { setEditing(null); return; }
    const r = await fetch(`/api/capi/pixels/${pixelId}/mappings`);
    const j = await r.json();
    setMappings(j.mappings || []); setMetaEvents(j.events || []); setEditing(pixelId);
  }
  async function saveMapping(pixelId: string) {
    await fetch(`/api/capi/pixels/${pixelId}/mappings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mappings }) });
    setEditing(null); setMsg("Event mapping saved."); load();
  }
  async function historical(range: string) {
    setBusy("Queuing historical conversions…");
    const r = await fetch("/api/capi/historical", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ range }) });
    const j = await r.json(); setBusy("");
    if (!r.ok) return setMsg(j.error || "Could not resend.");
    setMsg(`Historical resend: ${j.queued} queued, ${j.deduped} already sent (deduped), ${j.scanned} leads scanned.`);
    load();
  }
  async function retryEvent(id: string) {
    await fetch(`/api/capi/events/${id}/retry`, { method: "POST" });
    load();
  }

  if (!loaded) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Meta Conversions API</h1>
        <p className="text-sm text-slate-500 mt-1">Send CRM conversion events back to Meta to improve Event Match Quality, attribution, and campaign performance. Reuses your existing Meta connection — no second login.</p>
      </div>
      {msg && <div className="text-sm bg-blue-50 text-blue-800 rounded-md px-3 py-2">{msg}</div>}

      {/* Diagnostics */}
      {diag && (
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Diagnostics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              ["Pixel", diag.pixelConnected ? "Connected" : "None"],
              ["OAuth", diag.oauth.hasToken ? "Authorized" : "Reconnect"],
              ["Events (24h)", String(diag.events24h)],
              ["Success rate", diag.successRate != null ? `${diag.successRate}%` : "—"],
              ["Failure rate", diag.failureRate != null ? `${diag.failureRate}%` : "—"],
              ["Avg latency", diag.avgLatencyMs != null ? `${diag.avgLatencyMs}ms` : "—"],
              ["Permissions", diag.permissions === "granted" ? "OK" : "Missing token"],
            ].map(([k, v]) => (
              <div key={k} className="bg-slate-50 rounded-md p-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
                <div className="text-sm font-medium text-slate-800">{v}</div>
              </div>
            ))}
            <div className="bg-slate-50 rounded-md p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Match Quality</div>
              <div className={`text-sm font-medium rounded px-2 inline-block ${EMQ_COLOR[diag.eventMatchQuality] || ""}`}>{diag.eventMatchQuality}</div>
            </div>
          </div>
        </section>
      )}

      {/* Connect a pixel */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Connect a Pixel</h2>
        {accounts.length === 0 ? (
          <p className="text-xs text-slate-500">Connect a Meta account on the <a href="/settings/connector" className="text-blue-600">Lead Sources</a> page first, then reconnect it to grant Conversions API access.</p>
        ) : (
          <div className="space-y-2">
            <select value={acctId} onChange={(e) => pickAccount(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select a connected Meta account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id} disabled={!a.hasToken}>{a.label || a.id}{!a.hasToken ? " (reconnect for CAPI)" : ""}</option>)}
            </select>
            {businesses.length > 0 && (
              <select value={bizId} onChange={(e) => pickBusiness(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select a Business…</option>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            {adAccounts.length > 0 && (
              <select value={adAcctId} onChange={(e) => pickAdAccount(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select an Ad Account…</option>
                {adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {pixelChoices.length > 0 && (
              <select value={chosenPixel} onChange={(e) => setChosenPixel(e.target.value)} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                <option value="">Select a Pixel / Dataset…</option>
                {pixelChoices.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
              </select>
            )}
            {chosenPixel && (
              <div className="flex gap-2 items-center">
                <input value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="Test event code (optional)" className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm" />
                <button onClick={connectPixel} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Connect Pixel</button>
              </div>
            )}
            {busy && <p className="text-xs text-slate-400">{busy}</p>}
          </div>
        )}
      </section>

      {/* Connected pixels + mapping */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Connected Pixels & Event Mapping</h2>
        {pixels.length === 0 ? <p className="text-xs text-slate-400">No pixels connected yet.</p> : (
          <div className="space-y-3">
            {pixels.map((p) => (
              <div key={p.id} className="border border-slate-100 rounded-md p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{p.pixelName || p.pixelId} <span className="text-xs text-slate-400">({p.pixelId})</span></p>
                    <p className="text-xs text-slate-500">{[p.businessName, p.adAccountName].filter(Boolean).join(" · ") || "—"}{p.testEventCode ? ` · test: ${p.testEventCode}` : ""}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openMapping(p.id)} className="text-xs px-3 py-1.5 rounded-md border border-slate-200">{editing === p.id ? "Close" : "Event mapping"}</button>
                    <button onClick={() => removePixel(p.id)} className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-red-600">Disconnect</button>
                  </div>
                </div>
                {editing === p.id && (
                  <div className="mt-3 space-y-1.5">
                    {mappings.map((m, i) => (
                      <div key={m.trigger} className="flex items-center gap-2">
                        <span className="text-xs text-slate-600 w-40 truncate" title={m.label}>{m.label}<span className="text-slate-300"> · {m.kind}</span></span>
                        <span className="text-slate-300">→</span>
                        <select value={m.metaEvent || ""} onChange={(e) => setMappings((prev) => prev.map((x, idx) => idx === i ? { ...x, metaEvent: e.target.value || null } : x))} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
                          <option value="">No Event</option>
                          {metaEvents.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
                          {m.metaEvent && !metaEvents.includes(m.metaEvent) && <option value={m.metaEvent}>{m.metaEvent}</option>}
                        </select>
                        <label className="text-xs text-slate-500 flex items-center gap-1"><input type="checkbox" checked={m.enabled} onChange={(e) => setMappings((prev) => prev.map((x, idx) => idx === i ? { ...x, enabled: e.target.checked } : x))} /> on</label>
                      </div>
                    ))}
                    <button onClick={() => saveMapping(p.id)} className="mt-2 bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-md">Save mapping</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Historical resend */}
      {pixels.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Resend Historical Conversions</h2>
          <p className="text-xs text-slate-500 mb-3">Backfill Meta with past conversions. Already-sent events are automatically deduplicated.</p>
          <div className="flex gap-2">
            <button onClick={() => historical("7d")} className="text-xs px-3 py-2 rounded-md border border-slate-200">Last 7 days</button>
            <button onClick={() => historical("30d")} className="text-xs px-3 py-2 rounded-md border border-slate-200">Last 30 days</button>
          </div>
        </section>
      )}

      {/* Delivery log */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Conversions Delivery Log</h2>
        {events.length === 0 ? <p className="text-xs text-slate-400">No conversion events yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 text-left"><th className="py-1 pr-3">Time</th><th className="pr-3">Lead</th><th className="pr-3">Event</th><th className="pr-3">Pixel</th><th className="pr-3">Status</th><th className="pr-3">Latency</th><th className="pr-3">EMQ</th><th className="pr-3">Retries</th><th></th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="pr-3 text-slate-700 truncate max-w-[110px]">{e.leadName || "—"}</td>
                    <td className="pr-3 text-slate-800">{e.eventName}{e.origin === "historical" ? <span className="text-slate-400"> ·h</span> : ""}</td>
                    <td className="pr-3 text-slate-500 truncate max-w-[90px]" title={e.pixelId || ""}>{e.pixelName || e.pixelId || "—"}</td>
                    <td className="pr-3"><span className={`rounded px-1.5 py-0.5 ${STATUS_COLOR[e.status] || ""}`}>{e.status}</span></td>
                    <td className="pr-3 text-slate-500">{e.latencyMs != null ? `${e.latencyMs}ms` : "—"}</td>
                    <td className="pr-3"><span className={`rounded px-1.5 ${e.eventMatchQuality ? EMQ_COLOR[e.eventMatchQuality] || "" : ""}`}>{e.eventMatchQuality || "—"}</span></td>
                    <td className="pr-3 text-slate-500">{e.attempts}</td>
                    <td>{(e.status === "failed" || e.status === "dead_letter") && <button onClick={() => retryEvent(e.id)} className="text-blue-600">Retry</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
