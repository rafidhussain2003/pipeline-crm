"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeLeadStream } from "@/lib/leads/stream-client";

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

// --- Chime definition (shared by the Web Audio path and the WAV fallback) --
// Two rising sine notes, ~0.95s total, 30ms exponential attack, exponential
// fade to silence. Peak 0.12 ≈ -18 dBFS — clearly audible, not startling.
const CHIME_NOTES = [
  { freq: 880, start: 0, dur: 0.5 },
  { freq: 1318.51, start: 0.18, dur: 0.72 },
] as const;
const CHIME_SECONDS = 0.95;
const CHIME_PEAK = 0.12;
const CHIME_ATTACK = 0.03;
const CHIME_FLOOR = 0.0001;

// Fallback sound for when Web Audio can't run (unavailable, or its context
// refuses to leave "suspended"): the SAME chime rendered sample-by-sample
// into a 16-bit PCM WAV at runtime — no audio asset to ship — and played
// through a plain <audio> element. Built once, cached as an object URL.
let chimeWavUrl: string | null = null;
function getChimeWavUrl(): string {
  if (chimeWavUrl) return chimeWavUrl;
  const SR = 22050;
  const total = Math.ceil(SR * CHIME_SECONDS);
  const samples = new Float32Array(total);
  for (const { freq, start, dur } of CHIME_NOTES) {
    const s0 = Math.floor(start * SR);
    const sN = Math.min(total, Math.floor((start + dur) * SR));
    for (let i = s0; i < sN; i++) {
      const t = i / SR - start;
      const env =
        t < CHIME_ATTACK
          ? CHIME_FLOOR * Math.pow(CHIME_PEAK / CHIME_FLOOR, t / CHIME_ATTACK)
          : CHIME_PEAK * Math.pow(CHIME_FLOOR / CHIME_PEAK, (t - CHIME_ATTACK) / (dur - CHIME_ATTACK));
      samples[i] += env * Math.sin(2 * Math.PI * freq * (i / SR));
    }
  }
  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const wstr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF"); v.setUint32(4, 36 + total * 2, true); wstr(8, "WAVE");
  wstr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wstr(36, "data"); v.setUint32(40, total * 2, true);
  for (let i = 0; i < total; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  chimeWavUrl = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return chimeWavUrl;
}

export default function LeadAssignedAlerts() {
  const router = useRouter();
  const [queue, setQueue] = useState<Toast[]>([]);
  const [overflow, setOverflow] = useState(0);
  const [hovered, setHovered] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<AudioContext | null>(null);
  const fallbackRef = useRef<HTMLAudioElement | null>(null);
  const lastChimeRef = useRef(0);

  // Browsers only allow sound after a user gesture. The context is created
  // AND resumed inside the gesture handler: Chrome may hand back a context
  // already in "suspended" state even when constructed during pointerdown —
  // the root cause of the silent-notification bug — and resume() is only
  // guaranteed to be honored while a gesture is active. The listeners are NOT
  // one-shot: they stay armed until the context is verifiably RUNNING, so a
  // first gesture that Chrome didn't count (e.g. before the page settled)
  // isn't the only chance we ever get.
  useEffect(() => {
    const disarmIfRunning = () => {
      if (audioRef.current?.state !== "running") return;
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("touchend", arm);
    };
    const arm = () => {
      try {
        if (!audioRef.current) {
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx) audioRef.current = new Ctx();
        }
        const ctx = audioRef.current;
        if (!ctx) return; // Web Audio unavailable — the WAV fallback handles playback
        if (ctx.state !== "running") void ctx.resume().then(disarmIfRunning).catch(() => {});
        else disarmIfRunning();
      } catch {
        /* Web Audio unavailable — the WAV fallback handles playback */
      }
    };
    window.addEventListener("pointerdown", arm, { passive: true });
    window.addEventListener("keydown", arm);
    window.addEventListener("touchend", arm, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("touchend", arm);
    };
  }, []);

  useEffect(() => {
    // Path 1: Web Audio, ONLY when the context is verifiably running. The old
    // implementation scheduled against a suspended context: its currentTime
    // clock is FROZEN, so once resume() landed, every gain-automation point
    // was already in the past and the envelope collapsed straight to its
    // 0.0001 end value — the oscillators "played" at -80 dBFS. Toast visible,
    // sound inaudible, no error anywhere.
    const playViaWebAudio = (): boolean => {
      const ctx = audioRef.current;
      if (!ctx || ctx.state !== "running") return false;
      try {
        const t0 = ctx.currentTime; // live clock — the context is running
        for (const { freq, start, dur } of CHIME_NOTES) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(CHIME_FLOOR, t0 + start);
          gain.gain.exponentialRampToValueAtTime(CHIME_PEAK, t0 + start + CHIME_ATTACK);
          gain.gain.exponentialRampToValueAtTime(CHIME_FLOOR, t0 + start + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t0 + start);
          osc.stop(t0 + start + dur + 0.05);
        }
        return true;
      } catch (err) {
        console.warn("[lead-alert] Web Audio chime failed, using fallback:", err);
        return false;
      }
    };

    // Path 2: plain <audio> with the runtime-rendered WAV. One element,
    // restarted from 0 each time — two alerts can never overlap. If even this
    // is blocked (the user hasn't interacted with the page at all yet —
    // browsers allow NO sound before the first gesture), say so in the
    // console instead of failing silently.
    const playViaFallback = () => {
      try {
        if (!fallbackRef.current) fallbackRef.current = new Audio(getChimeWavUrl());
        const el = fallbackRef.current;
        el.currentTime = 0;
        el.play().catch((err) => {
          console.warn("[lead-alert] notification sound blocked by the browser (no user interaction on this page yet?):", err);
        });
      } catch (err) {
        console.warn("[lead-alert] notification sound unavailable:", err);
      }
    };

    const chime = () => {
      const now = Date.now();
      // Burst guard: one chime per window, shared by BOTH paths — a bulk
      // assignment rings once, never continuously, never overlapping.
      if (now - lastChimeRef.current < CHIME_MIN_GAP_MS) return;
      lastChimeRef.current = now;
      if (playViaWebAudio()) return;
      // Web Audio couldn't run: nudge the context for next time (harmless if
      // the browser refuses) and play through the audio element now.
      void audioRef.current?.resume().catch(() => {});
      playViaFallback();
    };

    const onAssigned = (raw: string) => {
      let data: Toast;
      try {
        data = JSON.parse(raw);
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

    // Shared tab-wide stream (see stream-client.ts) — this component being
    // mounted in the persistent app layout is what keeps the one connection
    // warm across page navigations for every other consumer too.
    return subscribeLeadStream({ events: { "lead.assigned.me": onAssigned } });
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
