"use client";

import { useCallback, useEffect, useState } from "react";
import ScheduleCallbackModal from "./ScheduleCallbackModal";
import { STATUS_STYLES } from "./styles";

// Follow-up & Pipeline Part 3: at-a-glance due indicators on open callbacks.
function dueBadge(scheduledAt: string): { label: string; cls: string } | null {
  const due = new Date(scheduledAt);
  const now = new Date();
  if (due.getTime() < now.getTime()) return { label: "Overdue", cls: "text-red-700 bg-red-50" };
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAhead = Math.floor((due.getTime() - startOfToday.getTime()) / 86_400_000);
  if (daysAhead <= 0) return { label: "Today", cls: "text-amber-700 bg-amber-50" };
  if (daysAhead === 1) return { label: "Tomorrow", cls: "text-sky-700 bg-sky-50" };
  return null;
}

type Callback = {
  id: string;
  scheduledAt: string;
  timezone: string;
  reason: string;
  notes: string | null;
  priority: string;
  status: string;
  agentName: string | null;
  rescheduleCount: number;
  completedAt: string | null;
};

// The "Schedule Callback" surface on the Lead Details page: the button the spec
// asks for on every lead, plus this lead's callback history right underneath it.
//
// Lead Workspace additions (both optional, both counters so repeat triggers
// work): `openRequest` — bumping it opens the schedule modal (the Quick
// Actions panel's button); `refreshToken` — bumping it re-fetches the list
// (the page's realtime stream saw a callback change).
export default function LeadCallbacks({
  leadId,
  leadName,
  openRequest,
  refreshToken,
  onChanged,
}: {
  leadId: string;
  leadName: string | null;
  openRequest?: number;
  refreshToken?: number;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Callback[]>([]);
  const [modal, setModal] = useState<{ existingId?: string; initial?: Callback } | null>(null);
  // null = first load in flight; false = module disabled for this company
  // (Phase 18) — render nothing at all, the card must not exist for them.
  const [available, setAvailable] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/callbacks?leadId=${leadId}`);
    if (!res.ok) {
      setAvailable(false);
      return;
    }
    const data = await res.json();
    setItems(data.items || []);
    setAvailable(true);
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (openRequest) setModal({});
  }, [openRequest]);

  useEffect(() => {
    if (refreshToken) load();
  }, [refreshToken, load]);

  async function act(id: string, action: "complete" | "cancel") {
    await fetch(`/api/callbacks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    load();
    onChanged?.();
  }

  const open = items.filter((c) => c.status === "scheduled" || c.status === "due" || c.status === "missed");
  const past = items.filter((c) => !open.includes(c));

  if (available !== true) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">Callbacks</h2>
        <button onClick={() => setModal({})} className="bg-slate-900 text-white text-xs font-medium px-3 py-1.5 rounded-md">
          Schedule Callback
        </button>
      </div>

      {items.length === 0 && <p className="text-xs text-slate-400">No callbacks scheduled for this lead.</p>}

      <div className="space-y-2">
        {open.map((c) => (
          <div key={c.id} className="border border-slate-200 rounded-md p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLES[c.status] || STATUS_STYLES.scheduled}`}>{c.status}</span>
                  {(() => {
                    const badge = dueBadge(c.scheduledAt);
                    return badge ? (
                      <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.label}</span>
                    ) : null;
                  })()}
                  <span className="text-sm font-medium text-slate-900">{new Date(c.scheduledAt).toLocaleString()}</span>
                  {c.priority !== "normal" && <span className="text-[10px] font-medium text-slate-500 capitalize">{c.priority} priority</span>}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {c.reason}
                  {c.agentName && ` · ${c.agentName}`}
                  {c.rescheduleCount > 0 && ` · rescheduled ${c.rescheduleCount}×`}
                </div>
                {c.notes && <div className="text-xs text-slate-400 mt-1">{c.notes}</div>}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => act(c.id, "complete")} className="text-[11px] font-medium text-emerald-700 bg-emerald-50 rounded-md px-2 py-1">Complete</button>
                <button onClick={() => setModal({ existingId: c.id, initial: c })} className="text-[11px] font-medium text-slate-600 bg-slate-100 rounded-md px-2 py-1">Reschedule</button>
                <button onClick={() => act(c.id, "cancel")} className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded-md px-2 py-1">Cancel</button>
              </div>
            </div>
          </div>
        ))}

        {past.length > 0 && (
          <div className="pt-2 mt-1 border-t border-slate-100 space-y-1.5">
            {past.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-xs text-slate-400">
                <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLES[c.status] || STATUS_STYLES.scheduled}`}>{c.status}</span>
                <span>{new Date(c.scheduledAt).toLocaleString()}</span>
                <span className="truncate">· {c.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <ScheduleCallbackModal
          leadId={leadId}
          leadName={leadName}
          existingId={modal.existingId}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={() => {
            load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
