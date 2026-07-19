"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ScheduleCallbackModal from "@/components/callbacks/ScheduleCallbackModal";
import { PRIORITY_STYLES, STATUS_STYLES, relativeTime } from "@/components/callbacks/styles";

type Row = {
  id: string;
  leadId: string;
  agentId: string;
  scheduledAt: string;
  timezone: string;
  reason: string;
  notes: string | null;
  priority: string;
  status: string;
  priorityScore: number;
  rescheduleCount: number;
  completedAt: string | null;
  leadName: string | null;
  leadPhone: string | null;
  leadDisposition: string | null;
  agentName: string | null;
};
type Counts = { today: number; upcoming: number; overdue: number; completed: number };

const TABS: { key: keyof Counts; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
];
const REASONS = [
  "Customer requested callback", "Busy right now", "Requested after work",
  "Requested next week", "Payment pending", "Installation follow-up", "Other",
];

export default function CallbacksPage() {
  const [tab, setTab] = useState<keyof Counts>("today");
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts>({ today: 0, upcoming: 0, overdue: 0, completed: 0 });
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [reschedule, setReschedule] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ tab });
    if (search.trim()) p.set("search", search.trim());
    if (priority) p.set("priority", priority);
    if (reason) p.set("reason", reason);
    const res = await fetch(`/api/callbacks?${p}`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.items || []);
      setCounts(data.counts || counts);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, priority, reason]);

  // Debounced so typing in the search box doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function act(id: string, action: "complete" | "cancel") {
    await fetch(`/api/callbacks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    load();
  }

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Callbacks</h1>
      <p className="text-sm text-slate-500 mt-1">Ordered by what to call first — the AI weighs how overdue it is, the priority, and the lead&apos;s value.</p>

      {/* Tabs */}
      <div className="flex gap-1 mt-5 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-[11px] rounded-full px-1.5 py-0.5 ${t.key === "overdue" && counts.overdue > 0 ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"}`}>
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-2 mt-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or email…"
          className="flex-1 min-w-[200px] rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
          <option value="">All priorities</option>
          {["urgent", "high", "normal", "low"].map((p) => (
            <option key={p} value={p} className="capitalize">{p}</option>
          ))}
        </select>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
          <option value="">All reasons</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="mt-4 space-y-2">
        {loading && rows.length === 0 && <p className="text-sm text-slate-400">Loading…</p>}
        {!loading && rows.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
            <p className="text-sm text-slate-400">
              {tab === "overdue" ? "Nothing overdue — you're on top of it." : tab === "completed" ? "No completed callbacks yet." : "No callbacks here."}
            </p>
          </div>
        )}
        {rows.map((r) => {
          const overdue = new Date(r.scheduledAt).getTime() < Date.now() && (r.status === "scheduled" || r.status === "due" || r.status === "missed");
          return (
            <div key={r.id} className={`bg-white border rounded-lg p-4 ${overdue ? "border-red-200" : "border-slate-200"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/leads/${r.leadId}`} className="text-sm font-semibold text-slate-900 hover:text-blue-700 truncate">
                      {r.leadName || "Unknown lead"}
                    </Link>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLES[r.status] || STATUS_STYLES.scheduled}`}>{r.status}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${PRIORITY_STYLES[r.priority] || PRIORITY_STYLES.normal}`}>{r.priority}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {new Date(r.scheduledAt).toLocaleString()}
                    <span className={overdue ? "text-red-600 font-medium" : ""}> · {relativeTime(r.scheduledAt)}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    {r.reason}
                    {r.leadPhone && ` · ${r.leadPhone}`}
                    {r.agentName && ` · ${r.agentName}`}
                    {r.rescheduleCount > 0 && ` · rescheduled ${r.rescheduleCount}×`}
                  </div>
                  {r.notes && <div className="text-xs text-slate-400 mt-1 truncate">{r.notes}</div>}
                </div>
                {tab !== "completed" && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => act(r.id, "complete")} className="text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded-md px-2 py-1.5">Complete</button>
                    <button onClick={() => setReschedule(r)} className="text-[11px] font-medium text-slate-600 bg-slate-100 rounded-md px-2 py-1.5">Reschedule</button>
                    <button onClick={() => act(r.id, "cancel")} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded-md px-2 py-1.5">Cancel</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {reschedule && (
        <ScheduleCallbackModal
          leadId={reschedule.leadId}
          leadName={reschedule.leadName}
          existingId={reschedule.id}
          initial={reschedule}
          onClose={() => setReschedule(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
