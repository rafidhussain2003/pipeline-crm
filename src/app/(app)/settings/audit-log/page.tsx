"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  userName: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "logged in",
  "auth.logout": "logged out",
  "disposition.created": "added a disposition option",
  "company_settings.updated": "updated company settings",
  "account.updated": "updated their profile",
  "user.password_changed": "changed their password",
  "account.email_changed": "changed their email",
  "account.sessions_revoked": "signed out other devices",
  "lead.created": "created a lead",
  "lead.disposition_changed": "changed a lead's disposition",
  "lead.reassigned": "reassigned a lead",
  "lead.deleted": "deleted a lead",
  "lead.note_added": "added a note",
  "lead.attachment_added": "added an attachment",
  "lead.auto_recycled": "auto-recycled a lead",
  "lead.force_recycled": "force-recycled a lead",
  "lead.rebalanced": "rebalanced a lead to another agent",
  "leads.imported": "imported leads",
  "agent.added": "added an agent",
  "agent.updated": "updated an agent",
  "agent.removed": "removed an agent",
  "agent.locked": "locked an agent",
  "agent.unlocked": "unlocked an agent",
  "agent.password_reset": "reset an agent's password",
  "company.signed_up": "signed up",
  "company.status_changed": "changed company status",
  "webhook_source.created": "connected a lead source",
  "lead_source.connected": "connected a Meta Lead Ads page",
  "lead_source.reconnected": "reconnected a Meta Lead Ads page",
  "lead_source.disconnected": "disconnected a lead source",
  "lead_source.synced": "synced a lead source",
  "lead_form.enabled": "enabled a lead form",
  "lead_form.disabled": "disabled a lead form",
  "connected_account.disconnected": "disconnected a Meta account",
  "lead.created_from_facebook": "received a lead from Meta Lead Ads",
  "lead.created_from_website": "received a lead from a website form",
  "lead.created_from_webhook": "received a lead from a connected source",
};

export default function AuditLogPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  // Loads one page of 50. With a cursor (the oldest visible entry) it
  // appends the NEXT 50 older entries; without one it loads the first page.
  async function loadPage(cursor?: { before: string; beforeId: string }) {
    setError("");
    const params = new URLSearchParams();
    if (cursor) {
      params.set("before", cursor.before);
      params.set("beforeId", cursor.beforeId);
    }
    try {
      const res = await fetch(`/api/audit-log${params.size ? `?${params}` : ""}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not load the audit log");
      const d = await res.json();
      const page: Entry[] = d.entries || [];
      setEntries((prev) => {
        if (!cursor) return page;
        // Belt-and-braces dedupe on append — the cursor already prevents
        // overlaps, this keeps React keys safe no matter what.
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.filter((e) => !seen.has(e.id))];
      });
      setHasMore(!!d.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the audit log");
    }
  }

  useEffect(() => {
    loadPage().finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    const last = entries[entries.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    await loadPage({ before: last.createdAt, beforeId: last.id });
    setLoadingMore(false);
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Audit Log</h1>
      <p className="text-sm text-slate-500 mb-6">A record of who did what, for governance and accountability.</p>

      {error && (
        <div role="alert" className="mb-4 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {loading && <div className="p-4 text-sm text-slate-400">Loading…</div>}
        {!loading && entries.length === 0 && <div className="p-4 text-sm text-slate-400">No activity recorded yet.</div>}
        {entries.map((e) => (
          <div key={e.id} className="p-3 flex items-center justify-between">
            <div className="text-sm text-slate-700">
              <span className="font-medium text-slate-900">{e.userName || "System"}</span>{" "}
              {ACTION_LABELS[e.action] || e.action}
            </div>
            <div className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Next 50 older entries, on demand — the page never loads more than
          the admin actually asks to see. */}
      {!loading && hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md px-5 py-2 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more logs"}
          </button>
        </div>
      )}
      {!loading && !hasMore && entries.length > 0 && (
        <p className="mt-4 text-center text-xs text-slate-400">End of the audit log.</p>
      )}
    </div>
  );
}
