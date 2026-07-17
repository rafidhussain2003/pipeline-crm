"use client";

import { useCallback, useEffect, useState } from "react";
import ScheduleCallbackModal from "./ScheduleCallbackModal";
import { STATUS_STYLES } from "./styles";

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
export default function LeadCallbacks({ leadId, leadName }: { leadId: string; leadName: string | null }) {
  const [items, setItems] = useState<Callback[]>([]);
  const [modal, setModal] = useState<{ existingId?: string; initial?: Callback } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/callbacks?leadId=${leadId}`);
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.items || []);
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: "complete" | "cancel") {
    await fetch(`/api/callbacks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    load();
  }

  const open = items.filter((c) => c.status === "scheduled" || c.status === "due" || c.status === "missed");
  const past = items.filter((c) => !open.includes(c));

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
          onSaved={load}
        />
      )}
    </div>
  );
}
