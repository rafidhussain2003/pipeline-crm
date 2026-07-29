"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { subscribeLeadStream } from "@/lib/leads/stream-client";

// Manager Console — Fresh Leads. The Lead Distribution Manager's primary
// workspace, optimized for one job: decide which agent gets a lead and assign
// it. All customer identity is governed by the backend (Manager Privacy Mode);
// this page just renders whatever /api/leads returns and reads the `masked`
// flag it sends back to adapt (no workspace link, no PII, when masked).

type Lead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  disposition: string;
  createdAt: string;
  assignedAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  isDuplicate: boolean;
  state: string | null;
  priority: string;
  source: string | null;
  form: string | null;
};

type Assignee = { id: string; name: string; role: string; online: boolean; openLeadCount: number };

function leadAge(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// Compact agent picker used for both Assign and Reassign.
function AssignPicker({ count, onClose, onPick }: { count: number; onClose: () => void; onPick: (agentId: string) => Promise<string | null> }) {
  const [agents, setAgents] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leads/assignees")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not load the team");
        setAgents((await r.json()).assignees || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the team"))
      .finally(() => setLoading(false));
  }, []);

  async function pick(agentId: string) {
    if (busyId) return;
    setBusyId(agentId);
    setError("");
    const fail = await onPick(agentId);
    if (fail) {
      setError(fail);
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !busyId && onClose()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-lg shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Assign {count === 1 ? "1 lead" : `${count} leads`} to…</h2>
          <button onClick={onClose} disabled={!!busyId} aria-label="Close" className="text-slate-400 hover:text-slate-600 disabled:opacity-40 text-lg leading-none px-1">×</button>
        </div>
        {error && <div role="alert" className="mx-5 mt-4 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">{error}</div>}
        <div className="max-h-80 overflow-y-auto p-2">
          {loading && <div className="px-4 py-8 text-center text-sm text-slate-400">Loading team…</div>}
          {!loading && agents.length === 0 && !error && <div className="px-4 py-8 text-center text-sm text-slate-400">No active team members.</div>}
          {agents.map((a) => (
            <button key={a.id} onClick={() => pick(a.id)} disabled={!!busyId} className="w-full flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50">
              <span className="flex items-center gap-2.5 min-w-0">
                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${a.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900 truncate">{busyId === a.id ? "Assigning…" : a.name}</span>
                  <span className="block text-xs text-slate-500">{a.online ? "Online" : "Offline"} · {a.openLeadCount} open</span>
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{a.role}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const STATUS_TABS = [
  { key: "unassigned", label: "Fresh" },
  { key: "assigned", label: "Assigned" },
  { key: "", label: "All" },
];

export default function FreshLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [masked, setMasked] = useState(true);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("unassigned");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerFor, setPickerFor] = useState<{ ids: string[] } | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError("");
    const p = new URLSearchParams();
    if (status) p.set("assigned", status);
    if (search) p.set("search", search);
    p.set("pageSize", "100");
    try {
      const res = await fetch(`/api/leads?${p.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not load leads (${res.status})`);
      const data = await res.json();
      setLeads(data.leads || []);
      setMasked(!!data.masked);
      setTotal(data.total ?? 0);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load leads");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  // Realtime: a new arrival or an assignment elsewhere refreshes the list.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    const bump = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => loadRef.current({ silent: true }), 500); };
    return subscribeLeadStream({ events: { "lead.created": bump, "lead.assigned": bump } });
  }, []);

  async function assignTo(ids: string[], agentId: string): Promise<string | null> {
    try {
      const res = await fetch("/api/leads/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids, agentId }),
      });
      if (!res.ok) return (await res.json().catch(() => ({}))).error || "Could not assign";
      setPickerFor(null);
      setNotice(`Assigned ${ids.length === 1 ? "1 lead" : `${ids.length} leads`}.`);
      await load({ silent: true });
      return null;
    } catch {
      return "Could not assign";
    }
  }

  const allSelected = leads.length > 0 && selected.size === leads.length;

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">
          Fresh Leads <span className="text-blue-600">{total.toLocaleString()} total</span>
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Assign incoming leads to your agents.{" "}
          {masked ? "Customer identity is protected (Privacy Mode on)." : "Full customer details are visible."}
        </p>
      </div>

      {notice && (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 text-sm bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-md px-3 py-2">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss" className="text-emerald-700 hover:text-emerald-900">×</button>
        </div>
      )}
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          <span>{error}</span>
          <button onClick={() => load()} className="text-xs font-semibold text-red-800 bg-red-100 hover:bg-red-200 rounded px-2.5 py-1">Retry</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`text-sm font-medium px-3 py-2 ${status === t.key ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={masked ? "Search (last 4 of phone…)" : "Search name, phone, email"}
          className="flex-1 min-w-[200px] max-w-sm rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5">
          <span className="text-sm font-medium text-blue-900">{selected.size === 1 ? "1 lead selected" : `${selected.size} leads selected`}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="text-sm font-medium text-slate-600 hover:text-slate-800 px-2 py-1.5">Clear</button>
            <button onClick={() => setPickerFor({ ids: [...selected] })} className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-4 py-1.5">Assign</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
              <th className="px-3 py-3 w-10">
                <input type="checkbox" aria-label="Select all" checked={allSelected} disabled={leads.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)))}
                  className="rounded border-slate-300" />
              </th>
              <th className="px-3 py-3">Lead</th>
              <th className="px-3 py-3">Phone</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Form</th>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">State</th>
              <th className="px-3 py-3">Priority</th>
              <th className="px-3 py-3">Owner</th>
              <th className="px-3 py-3">Age</th>
              <th className="px-3 py-3">Created</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && leads.length === 0 && <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-400">No leads here right now.</td></tr>}
            {leads.map((l) => (
              <tr key={l.id} className={`border-b border-slate-100 hover:bg-slate-50 ${selected.has(l.id) ? "bg-blue-50/50" : ""}`}>
                <td className="px-3 py-3">
                  <input type="checkbox" aria-label={`Select ${l.name || "lead"}`} checked={selected.has(l.id)}
                    onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
                    className="rounded border-slate-300" />
                </td>
                <td className="px-3 py-3">
                  {/* Masked ⇒ plain text (no PII, no workspace link). Unmasked ⇒
                      a link into the full lead like a trusted manager. */}
                  {masked ? (
                    <span className="font-medium text-slate-700">{l.name || "Fresh Lead"}</span>
                  ) : (
                    <Link href={`/leads/${l.id}`} className="font-medium text-blue-700 hover:underline">{l.name || "—"}</Link>
                  )}
                  {l.isDuplicate && <span className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">DUPLICATE</span>}
                </td>
                <td className="px-3 py-3 text-slate-700">{l.phone || "—"}</td>
                <td className="px-3 py-3"><span className="text-xs font-medium text-slate-600 bg-slate-100 rounded-full px-2 py-0.5">{l.disposition}</span></td>
                <td className="px-3 py-3 text-slate-600 truncate max-w-[160px]">{l.form || "—"}</td>
                <td className="px-3 py-3 text-slate-600 truncate max-w-[140px]">{l.source || "—"}</td>
                <td className="px-3 py-3 text-slate-600">{l.state || "—"}</td>
                <td className="px-3 py-3">
                  {l.priority === "high" ? <span className="text-xs font-semibold text-red-700">High</span> : <span className="text-slate-400 text-xs">Normal</span>}
                </td>
                <td className="px-3 py-3 text-slate-700">
                  {l.ownerName || <span className="text-slate-400">Unassigned</span>}
                  {l.assignedAt && <span className="block text-[11px] text-slate-400">{new Date(l.assignedAt).toLocaleString()}</span>}
                </td>
                <td className="px-3 py-3 text-slate-500">{leadAge(l.createdAt)}</td>
                <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="px-3 py-3 text-right">
                  <button onClick={() => setPickerFor({ ids: [l.id] })} className="text-xs font-semibold text-blue-700 hover:text-blue-900 whitespace-nowrap">
                    {l.ownerId ? "Reassign" : "Assign"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pickerFor && <AssignPicker count={pickerFor.ids.length} onClose={() => setPickerFor(null)} onPick={(agentId) => assignTo(pickerFor.ids, agentId)} />}
    </div>
  );
}
