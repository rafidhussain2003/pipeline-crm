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
};

export default function AuditLogPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/audit-log")
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.entries || []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Audit Log</h1>
      <p className="text-sm text-slate-500 mb-6">A record of who did what, for governance and accountability.</p>

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
    </div>
  );
}
