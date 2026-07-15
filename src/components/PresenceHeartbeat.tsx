"use client";

import { useEffect, useRef, useState } from "react";

// Heartbeat cadence — configurable via NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS so
// the client and the server's presence config agree from one source.
const HEARTBEAT_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS) || 30_000;
// Idle thresholds for the browser activity/lock heuristic (see
// evaluateEffectiveStatus). Visible-but-idle downgrades to "away" after the
// long threshold; a hidden tab (minimized, screen off, likely locked)
// downgrades after the short one.
const IDLE_AWAY_MS = Number(process.env.NEXT_PUBLIC_PRESENCE_IDLE_MS) || 5 * 60_000;
const HIDDEN_AWAY_MS = 60_000;

// Shared across every tab of the same origin: the chosen status (so all tabs
// agree) and a leader lease (so exactly one tab owns the heartbeat interval).
const STATUS_KEY = "ziplod_presence_status";
const LEADER_KEY = "ziplod_presence_leader";
const LEADER_TTL_MS = 12_000;
const LEADER_RENEW_MS = 5_000;

// Manually selectable states. Offline/locked/idle are NOT here: offline is
// sent automatically on tab close, "away" is applied automatically by the
// activity heuristic, and a crashed/locked machine can't self-report — the
// missing heartbeat is the signal the server derives from.
type Status = "online" | "busy" | "wrap_up" | "away" | "break" | "lunch";

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "busy", label: "Busy" },
  { value: "wrap_up", label: "Wrap Up" },
  { value: "away", label: "Away" },
  { value: "break", label: "Break" },
  { value: "lunch", label: "Lunch" },
];

const VALID: Status[] = STATUS_OPTIONS.map((s) => s.value);

function readStatus(): Status {
  if (typeof window === "undefined") return "online";
  const v = window.localStorage.getItem(STATUS_KEY);
  return v && (VALID as string[]).includes(v) ? (v as Status) : "online";
}

// --- Browser activity / lock heuristic ---
//
// The single, cleanly-abstracted place that turns raw browser signals (chosen
// status, last activity time, tab visibility) into the status to report. A
// future desktop agent replaces THIS function with real OS-level detection
// (actual lock/unlock, session change) and nothing else changes.
//
// Only the default "online" is subject to automatic downgrade; any explicitly
// chosen status (busy/away/break/lunch/wrap_up) is the user's intent and is
// left untouched. A truly locked/asleep machine can't run this at all — its
// heartbeats simply stop and the server derives AWAY -> OFFLINE from staleness.
function evaluateEffectiveStatus(chosen: Status, lastActivityMs: number, now: number): Status {
  if (chosen !== "online") return chosen;
  const idleMs = now - lastActivityMs;
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  if (idleMs > IDLE_AWAY_MS) return "away";
  if (hidden && idleMs > HIDDEN_AWAY_MS) return "away";
  return "online";
}

// Mounted once inside Sidebar for any company member (not super_admin — they
// don't take leads). One tab (the leader) heartbeats on the configured
// interval carrying the effective status; every tab beats immediately on
// regaining focus/visibility/network and on returning from idle, so a laptop
// waking from sleep, a reconnecting network, or an unlocked machine is marked
// available again within a second instead of waiting out the server timeout.
// On tab close it best-effort beacons "offline".
export default function PresenceHeartbeat() {
  const [status, setStatus] = useState<Status>("online");
  const statusRef = useRef<Status>("online");
  const lastActivityRef = useRef<number>(Date.now());
  const autoAwayRef = useRef<boolean>(false);
  const tabId = useRef<string>(Math.random().toString(36).slice(2) + Date.now().toString(36));

  useEffect(() => {
    const initial = readStatus();
    statusRef.current = initial;
    setStatus(initial);

    // Send a beat carrying the EFFECTIVE status (chosen status folded through
    // the activity/lock heuristic) plus timing signals for the server.
    const beat = () => {
      const now = Date.now();
      const effective = evaluateEffectiveStatus(statusRef.current, lastActivityRef.current, now);
      autoAwayRef.current = effective !== statusRef.current;
      fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: effective, sentAt: now, activeAt: lastActivityRef.current }),
        keepalive: true,
      }).catch(() => {
        // A missed heartbeat is expected sometimes (flaky connection); the
        // server-side staleness timeout handles it, the next tick/focus retries.
      });
    };

    // --- Leader election: exactly one tab owns the periodic heartbeat ---
    const isLeader = (): boolean => {
      try {
        const raw = window.localStorage.getItem(LEADER_KEY);
        if (!raw) return false;
        return (JSON.parse(raw) as { id: string }).id === tabId.current;
      } catch {
        return false;
      }
    };
    const tryClaimLeadership = () => {
      try {
        const raw = window.localStorage.getItem(LEADER_KEY);
        const now = Date.now();
        if (raw) {
          const lease = JSON.parse(raw) as { id: string; ts: number };
          if (lease.id !== tabId.current && now - lease.ts < LEADER_TTL_MS) return;
        }
        window.localStorage.setItem(LEADER_KEY, JSON.stringify({ id: tabId.current, ts: now }));
      } catch {
        // localStorage unavailable — every tab heartbeats itself; harmless.
      }
    };

    tryClaimLeadership();
    beat(); // one immediate beat on mount regardless of leadership

    const heartbeat = setInterval(() => {
      tryClaimLeadership();
      // Only the leader sends the periodic beat; if localStorage is blocked,
      // isLeader() is false everywhere so every tab falls back to sending.
      // Note: this interval firing late after the event loop was paused (the
      // machine slept) is itself the wake signal — it beats on resume.
      if (isLeader() || !window.localStorage.getItem(LEADER_KEY)) beat();
    }, HEARTBEAT_INTERVAL_MS);

    const renew = setInterval(() => tryClaimLeadership(), LEADER_RENEW_MS);

    // --- Activity detection: mouse, keyboard, scroll, touch ---
    // Records real user activity; when returning from an auto-"away" idle,
    // beats immediately so availability is restored without waiting a full
    // interval. Updating a ref on every event is negligible; beat() only fires
    // on the transition back from idle (autoAwayRef), so it can't spam.
    const markActivity = () => {
      lastActivityRef.current = Date.now();
      if (autoAwayRef.current) beat();
    };
    const activityEvents: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    for (const ev of activityEvents) window.addEventListener(ev, markActivity, { passive: true });
    window.addEventListener("scroll", markActivity, { passive: true, capture: true });

    // --- Fast recovery: beat immediately when the tab regains the ability to
    // reach the network (wake from sleep, unlock, refocus, reconnect) ---
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        lastActivityRef.current = Date.now();
        beat();
      } else {
        // Became hidden — re-evaluate now so a minimized/locked tab downgrades
        // promptly rather than only on the next interval.
        beat();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STATUS_KEY && e.newValue && (VALID as string[]).includes(e.newValue)) {
        statusRef.current = e.newValue as Status;
        setStatus(e.newValue as Status);
      }
    };
    window.addEventListener("focus", beat);
    window.addEventListener("online", beat);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);

    // --- Tab closing: best-effort "offline" beacon ---
    const sendOfflineBeacon = () => {
      navigator.sendBeacon?.(
        "/api/presence/heartbeat",
        new Blob([JSON.stringify({ status: "offline", sentAt: Date.now() })], { type: "application/json" })
      );
    };
    window.addEventListener("pagehide", sendOfflineBeacon);
    window.addEventListener("beforeunload", sendOfflineBeacon);

    return () => {
      clearInterval(heartbeat);
      clearInterval(renew);
      for (const ev of activityEvents) window.removeEventListener(ev, markActivity);
      window.removeEventListener("scroll", markActivity, { capture: true } as EventListenerOptions);
      window.removeEventListener("focus", beat);
      window.removeEventListener("online", beat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", sendOfflineBeacon);
      window.removeEventListener("beforeunload", sendOfflineBeacon);
    };
  }, []);

  function selectStatus(next: Status) {
    setStatus(next);
    statusRef.current = next;
    lastActivityRef.current = Date.now(); // choosing a status is itself activity
    autoAwayRef.current = false;
    try {
      window.localStorage.setItem(STATUS_KEY, next); // shared across tabs
    } catch {
      /* ignore */
    }
    fetch("/api/presence/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, sentAt: Date.now(), activeAt: Date.now() }),
    }).catch(() => {});
  }

  return (
    <div className="px-3 py-3 border-t border-slate-100">
      <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Your status</label>
      <select
        value={status}
        onChange={(e) => selectStatus(e.target.value as Status)}
        className="w-full text-sm font-medium rounded-md border border-slate-200 px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
