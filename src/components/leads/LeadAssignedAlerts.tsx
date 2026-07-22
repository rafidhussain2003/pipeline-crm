"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// New-lead alert (sound + floating notification), mounted once in the app
// layout so an assignment reaches the agent on whatever page they're on.
//
// Listens to the SAME /api/leads/stream connection contract every other
// realtime feature uses. The server sends "lead.assigned.me" ONLY on the
// connection belonging to the lead's new owner, already enriched
// (name/phone/source) and already filtered for self-assignments — this
// component never has to ask "is this mine?" and never sees anyone else's
// assignments.
//
// Queueing: one toast is visible at a time; further arrivals wait in FIFO
// order (a bulk assign of 50 leads must not stack 50 cards). The stored queue
// is capped — beyond it arrivals only bump a "+N more" counter shown on the
// card, and the leads list itself is always the complete truth.
//
// Sound: a short (~0.9s) two-tone chime synthesized with the Web Audio API —
// no audio asset to ship or cache-bust. Browsers block audio until the user
// has interacted with the page, so the AudioContext is created on the first
// pointer/key gesture; before that, alerts are visual only. A burst of
// assignments chimes once per 2.5s window, not once per lead.

type Toast = {
  leadId: string;
  name: string | null;
  phone: string | null;
  source: string | null;
  at: string;
};

const MAX_QUEUED = 6;
const TOAST_MS = 7_000;
const CHIME_MIN_GAP_MS = 2_500;
const SEEN_CAP = 300;

export default function LeadAssignedAlerts() {
  const router = useRouter();
  const [queue, setQueue] = useState<Toast[]>([]);
  const [overflow, setOverflow] = useState(0);
  const [hovered, setHovered] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<AudioContext | null>(null);
  const lastChimeRef = useRef(0);

  // Arm audio on the first real user gesture (autoplay policy). {once} — this
  // costs nothing after it fires.
  useEffect(() => {
    const arm = () => {
      if (audioRef.current) return;
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) audioRef.current = new Ctx();
      } catch {
        /* no audio — alerts stay visual */
      }
    };
    window.addEventListener("pointerdown", arm, { once: true, passive: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/leads/stream");

    const chime = () => {
      const ctx = audioRef.current;
      const now = Date.now();
      if (!ctx || now - lastChimeRef.current < CHIME_MIN_GAP_MS) return;
      lastChimeRef.current = now;
      try {
        if (ctx.state === "suspended") void ctx.resume();
        // Two rising sine notes, ~0.9s total, gentle exponential fade.
        const t0 = ctx.currentTime;
        for (const [freq, start, dur] of [
          [880, 0, 0.5],
          [1318.51, 0.18, 0.72],
        ] as const) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t0 + start);
          gain.gain.exponentialRampToValueAtTime(0.12, t0 + start + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t0 + start);
          osc.stop(t0 + start + dur + 0.05);
        }
      } catch {
        /* a failed chime must never break the notification */
      }
    };

    const onAssigned = (e: MessageEvent) => {
      let data: Toast;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!data?.leadId) return;
      // Once per assignment — an SSE reconnect or duplicate delivery must not
      // re-alert. Bounded so a week-long tab doesn't grow forever.
      const seen = seenRef.current;
      if (seen.has(data.leadId)) return;
      if (seen.size >= SEEN_CAP) seen.clear();
      seen.add(data.leadId);

      setQueue((prev) => {
        if (prev.length >= MAX_QUEUED) {
          setOverflow((n) => n + 1);
          return prev;
        }
        return [...prev, data];
      });
      chime();
    };

    es.addEventListener("lead.assigned.me", onAssigned);
    // EventSource reconnects by itself; nothing to do on error.
    return () => {
      es.removeEventListener("lead.assigned.me", onAssigned);
      es.close();
    };
  }, []);

  const current = queue[0];

  // Auto-dismiss the visible toast, advancing the queue. Hover pauses the
  // timer so the agent can actually read/click it.
  useEffect(() => {
    if (!current || hovered) return;
    const t = setTimeout(() => dismiss(), TOAST_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.leadId, current?.at, hovered]);

  function dismiss() {
    setQueue((prev) => {
      const next = prev.slice(1);
      if (next.length === 0) setOverflow(0);
      return next;
    });
  }

  function open(leadId: string) {
    dismiss();
    router.push(`/leads/${leadId}`);
  }

  if (!current) return null;

  const waiting = queue.length - 1 + overflow;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] w-80 max-w-[calc(100vw-2rem)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="status"
      aria-live="polite"
    >
      <div className="rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-start justify-between px-4 pt-3">
          <div className="text-sm font-semibold text-slate-900">🔥 New Lead Assigned</div>
          <button
            onClick={dismiss}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-slate-600 text-sm leading-none -mr-1 p-1"
          >
            ✕
          </button>
        </div>
        <button onClick={() => open(current.leadId)} className="block w-full text-left px-4 pb-1 pt-1">
          <div className="text-base font-semibold text-slate-900 truncate">{current.name || "New lead"}</div>
          {current.phone && <div className="text-sm text-slate-600 mt-0.5">{current.phone}</div>}
          {current.source && (
            <div className="inline-block text-[11px] font-medium text-blue-700 bg-blue-50 rounded-full px-2 py-0.5 mt-1.5">
              {current.source}
            </div>
          )}
        </button>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50">
          <button
            onClick={() => open(current.leadId)}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            View Lead →
          </button>
          {waiting > 0 && <span className="text-xs text-slate-500">+{waiting} more waiting</span>}
        </div>
      </div>
    </div>
  );
}
