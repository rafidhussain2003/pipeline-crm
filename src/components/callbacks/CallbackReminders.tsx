"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getVolume, isMuted, playChime, setMuted, setVolume } from "./chime";
import { relativeTime } from "./styles";

type Reminder = {
  callbackId: string;
  leadId: string;
  leadName: string | null;
  kind: string;
  label: string;
  scheduledAt: string;
  reason: string;
  priority: string;
  priorityScore: number;
  status: string;
  at: string;
};

// The global reminder surface, mounted once in the app layout. ONE EventSource
// per session; the server pushes and this never polls.
//
// Reminders stay on screen until the agent acknowledges them, and unacknowledged
// ones are replayed on connect ("due_batch"), so a reload or an agent who was
// offline when the reminder fired still sees it.
export default function CallbackReminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(0.5);
  const [showSound, setShowSound] = useState(false);
  const pathname = usePathname();

  // Read from localStorage after mount — server and client must agree on the
  // first render, and localStorage doesn't exist on the server.
  useEffect(() => {
    setMutedState(isMuted());
    setVolumeState(getVolume());
  }, []);

  // The lead the agent is currently looking at. If a reminder fires for THIS
  // lead, the spec asks for the subtle treatment — they're already on it.
  const viewingLeadId = pathname.startsWith("/leads/") ? pathname.split("/")[2] : null;
  const viewingRef = useRef<string | null>(null);
  viewingRef.current = viewingLeadId;

  const add = useCallback((r: Reminder, sound: boolean) => {
    setReminders((prev) => (prev.some((x) => x.callbackId === r.callbackId) ? prev.map((x) => (x.callbackId === r.callbackId ? r : x)) : [...prev, r]));
    // Silent when the agent is already on that lead's page — a chime for
    // something already in front of them is just noise.
    if (sound && viewingRef.current !== r.leadId) playChime();
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/callbacks/stream");
    // Replayed backlog: show it, but don't chime — these already fired.
    es.addEventListener("due_batch", (e) => {
      const batch = JSON.parse((e as MessageEvent).data) as Reminder[];
      for (const r of batch) add(r, false);
    });
    // A live reminder — this is the moment that earns a sound.
    es.addEventListener("reminder", (e) => add(JSON.parse((e as MessageEvent).data) as Reminder, true));
    // EventSource reconnects on its own; nothing to do on error.
    return () => es.close();
  }, [add]);

  async function acknowledge(callbackId: string) {
    setReminders((prev) => prev.filter((r) => r.callbackId !== callbackId));
    await fetch(`/api/callbacks/${callbackId}/acknowledge`, { method: "POST" }).catch(() => {});
  }

  async function complete(callbackId: string) {
    setReminders((prev) => prev.filter((r) => r.callbackId !== callbackId));
    await fetch(`/api/callbacks/${callbackId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    }).catch(() => {});
  }

  if (reminders.length === 0) return null;

  // Highest-priority reminder first — the AI score decides what the agent sees
  // on top when several fire at once.
  const sorted = [...reminders].sort((a, b) => b.priorityScore - a.priorityScore);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2">
      {sorted.map((r) => {
        const onThisLead = viewingLeadId === r.leadId;
        const overdue = r.status === "missed" || r.kind.startsWith("overdue");
        // Subtle when they're already on the lead; a real banner otherwise.
        if (onThisLead) {
          return (
            <div key={r.callbackId} className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${overdue ? "bg-red-500" : "bg-blue-500"}`} />
              <span className="text-xs text-slate-600 flex-1 min-w-0 truncate">{r.label} — you&apos;re on this lead</span>
              <button onClick={() => acknowledge(r.callbackId)} className="text-[11px] font-medium text-slate-400 hover:text-slate-600 shrink-0">Dismiss</button>
            </div>
          );
        }
        return (
          <div key={r.callbackId} className={`bg-white rounded-lg shadow-lg border-l-4 ${overdue ? "border-l-red-500" : "border-l-blue-500"} border border-slate-200 p-3`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className={`text-xs font-semibold ${overdue ? "text-red-700" : "text-blue-700"}`}>{r.label}</div>
                <div className="text-sm font-medium text-slate-900 truncate mt-0.5">{r.leadName || "Lead"}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {r.reason} · {relativeTime(r.scheduledAt)}
                </div>
              </div>
              <button onClick={() => acknowledge(r.callbackId)} aria-label="Dismiss reminder" className="text-slate-300 hover:text-slate-500 text-lg leading-none shrink-0">×</button>
            </div>
            <div className="flex gap-1.5 mt-2.5">
              <Link href={`/leads/${r.leadId}`} onClick={() => acknowledge(r.callbackId)} className="flex-1 text-center bg-slate-900 text-white text-[11px] font-medium px-2 py-1.5 rounded-md">
                Open lead
              </Link>
              <button onClick={() => complete(r.callbackId)} className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-1.5 rounded-md">Done</button>
            </div>
          </div>
        );
      })}

      {/* Sound controls live with the reminders — where an agent actually looks
          when they want the noise to stop. */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              const next = !muted;
              setMutedState(next);
              setMuted(next);
            }}
            className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
          >
            {muted ? "🔇 Sound off" : "🔔 Sound on"}
          </button>
          <button onClick={() => setShowSound((v) => !v)} className="text-[11px] font-medium text-slate-400 hover:text-slate-600">
            {showSound ? "Hide" : "Volume"}
          </button>
        </div>
        {showSound && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolumeState(v);
              setVolume(v);
            }}
            className="w-full mt-2"
            aria-label="Reminder volume"
          />
        )}
      </div>
    </div>
  );
}
