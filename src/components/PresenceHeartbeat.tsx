"use client";

import { useEffect, useRef, useState } from "react";

// Heartbeat cadence — configurable via NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS so
// the client and the server's presence config agree from one source.
const HEARTBEAT_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS) || 30_000;
// Idle fallback threshold (see evaluateEffectiveStatus). Deliberately LONG:
// an agent reading another screen, working in the dialer, or sitting in
// another app is STILL WORKING and must stay assignable — only a machine
// that has seen no input at all for this long is presumed locked/abandoned.
// Where the Idle Detection API is available and permitted, real lock
// detection replaces this guess entirely.
const IDLE_AWAY_MS = Number(process.env.NEXT_PUBLIC_PRESENCE_IDLE_MS) || 15 * 60_000;

// Shared across every tab of the same origin: the chosen status (so all tabs
// agree), a leader lease (so exactly one tab owns the heartbeat interval),
// and a live-tab registry (so only the LAST closing tab sends the offline
// beacon — closing one of three Ziplod tabs must not flicker the agent
// offline while the other two are still working).
const STATUS_KEY = "ziplod_presence_status";
const LEADER_KEY = "ziplod_presence_leader";
const TABS_KEY = "ziplod_presence_tabs";
const LEADER_TTL_MS = 12_000;
const LEADER_RENEW_MS = 5_000;
// A registry entry is renewed by the worker tick (HEARTBEAT_INTERVAL_MS, not
// throttleable) — anything older than this belongs to a tab that crashed or
// was discarded without firing pagehide.
const TAB_STALE_MS = Math.max(90_000, HEARTBEAT_INTERVAL_MS * 3);

// Manually selectable states. Offline/locked/idle are NOT here: offline is
// sent automatically when the last tab closes, "away" is applied
// automatically by lock detection / the idle fallback, and a crashed or
// asleep machine can't self-report — the missing heartbeat is the signal the
// server derives from.
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

// Minimal typings for the Idle Detection API (Chromium; not yet in lib.dom).
type IdleDetectorLike = {
  screenState: "locked" | "unlocked" | null;
  addEventListener(type: "change", listener: () => void): void;
  start(options: { threshold: number; signal?: AbortSignal }): Promise<void>;
};
type IdleDetectorCtor = {
  new (): IdleDetectorLike;
  requestPermission(): Promise<"granted" | "denied">;
};

// --- Browser activity / lock heuristic ---
//
// The single place that turns raw browser signals into the status to report.
//
// What the browser can and cannot know (documented limits, not bugs):
//   • Tab visibility CANNOT distinguish "agent is using the dialer on the
//     other monitor" from "screen is locked" — both look hidden. So a hidden
//     tab is deliberately NOT downgraded: an agent working in another app or
//     tab stays ONLINE and assignable.
//   • Real lock/unlock is only exposed by the Idle Detection API (Chromium,
//     behind a user permission). When available + granted, a locked screen
//     reports "away" the moment it locks and recovers the moment it unlocks.
//   • Everywhere else the fallback is input silence: no mouse/keyboard/touch
//     anywhere in Ziplod for IDLE_AWAY_MS (15 min default) reports "away" —
//     long enough that reading another screen never trips it.
//   • Sleep, shutdown, crashes and hard network loss can't run code at all;
//     heartbeats simply stop and the SERVER derives away → offline from
//     staleness (its thresholds are untouched here).
//
// Only the default "online" is subject to automatic downgrade; any explicitly
// chosen status (busy/away/break/lunch/wrap_up) is the user's intent and is
// left untouched.
function evaluateEffectiveStatus(chosen: Status, lastActivityMs: number, now: number, screenLocked: boolean): Status {
  if (chosen !== "online") return chosen;
  if (screenLocked) return "away";
  if (now - lastActivityMs > IDLE_AWAY_MS) return "away";
  return "online";
}

// Mounted once inside Sidebar for any company member (not super_admin — they
// don't take leads). One tab (the leader) heartbeats on the configured
// interval carrying the effective status; every tab beats immediately on
// regaining focus/visibility/network and on returning from idle or lock.
//
// The periodic tick runs in a tiny inline Web Worker, not a page timer:
// browsers throttle background-tab timers aggressively (Chrome: to once a
// minute, then once per TEN minutes after 5 minutes hidden), which silently
// starved the server's staleness window and marked working agents offline
// just because Ziplod wasn't the focused tab. Worker timers are exempt.
export default function PresenceHeartbeat() {
  const [status, setStatus] = useState<Status>("online");
  const statusRef = useRef<Status>("online");
  // Assigned real values on mount — impure initializers (Date.now /
  // Math.random) may not run during render under the React Compiler rules.
  const lastActivityRef = useRef<number>(0);
  const autoAwayRef = useRef<boolean>(false);
  const lockedRef = useRef<boolean>(false);
  const tabId = useRef<string>("");

  useEffect(() => {
    lastActivityRef.current = Date.now();
    if (!tabId.current) tabId.current = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const initial = readStatus();
    statusRef.current = initial;
    setStatus(initial);

    // Send a beat carrying the EFFECTIVE status (chosen status folded through
    // the activity/lock heuristic) plus timing signals for the server.
    const beat = () => {
      const now = Date.now();
      const effective = evaluateEffectiveStatus(statusRef.current, lastActivityRef.current, now, lockedRef.current);
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

    // --- Live-tab registry: who else has Ziplod open right now ---
    const renewTabEntry = () => {
      try {
        const reg = JSON.parse(window.localStorage.getItem(TABS_KEY) || "{}") as Record<string, number>;
        const now = Date.now();
        for (const [id, ts] of Object.entries(reg)) if (now - ts > TAB_STALE_MS) delete reg[id];
        reg[tabId.current] = now;
        window.localStorage.setItem(TABS_KEY, JSON.stringify(reg));
      } catch {
        /* registry unavailable → closing beacons offline, same as before */
      }
    };
    const removeTabEntryAndCheckLast = (): boolean => {
      try {
        const reg = JSON.parse(window.localStorage.getItem(TABS_KEY) || "{}") as Record<string, number>;
        delete reg[tabId.current];
        const now = Date.now();
        for (const [id, ts] of Object.entries(reg)) if (now - ts > TAB_STALE_MS) delete reg[id];
        window.localStorage.setItem(TABS_KEY, JSON.stringify(reg));
        return Object.keys(reg).length === 0;
      } catch {
        return true;
      }
    };

    // The periodic tick — from a Web Worker so background-tab timer
    // throttling can't starve it (the whole point; see component comment).
    const tick = () => {
      tryClaimLeadership();
      renewTabEntry();
      // Only the leader sends the periodic beat; if localStorage is blocked,
      // isLeader() is false everywhere so every tab falls back to sending.
      // This tick firing late after the event loop was paused (the machine
      // slept) is itself the wake signal — it beats on resume.
      try {
        if (isLeader() || !window.localStorage.getItem(LEADER_KEY)) beat();
      } catch {
        beat();
      }
    };

    tryClaimLeadership();
    renewTabEntry();
    beat(); // one immediate beat on mount regardless of leadership

    let worker: Worker | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    try {
      const src = `setInterval(function () { postMessage(1); }, ${HEARTBEAT_INTERVAL_MS});`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = tick;
    } catch {
      // Worker/blob blocked (strict CSP, ancient browser) — a page timer is
      // still correct, just throttleable in background tabs.
      fallbackTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    }

    const renew = setInterval(() => {
      tryClaimLeadership();
      renewTabEntry();
    }, LEADER_RENEW_MS);

    // --- Real lock detection where the browser offers it (Chromium) ---
    // Permission model: if already granted, start immediately; if not yet
    // decided, ask on the first user gesture (the API requires one). Denied
    // or unsupported → the idle fallback above is the documented behavior.
    const idleAbort = new AbortController();
    const IdleDetector = (window as unknown as { IdleDetector?: IdleDetectorCtor }).IdleDetector;
    const startLockDetector = async () => {
      if (!IdleDetector) return;
      try {
        const detector = new IdleDetector();
        detector.addEventListener("change", () => {
          const locked = detector.screenState === "locked";
          if (locked === lockedRef.current) return;
          lockedRef.current = locked;
          if (!locked) lastActivityRef.current = Date.now();
          // Report the transition immediately — locked drops to "away" now
          // (not at the next tick), unlock restores "online" within a second.
          beat();
        });
        await detector.start({ threshold: 60_000, signal: idleAbort.signal });
      } catch {
        /* permission revoked mid-flight or API quirk — fallback covers it */
      }
    };
    const armLockDetection = async () => {
      if (!IdleDetector) return;
      try {
        const query = navigator.permissions?.query?.bind(navigator.permissions);
        const state = query ? (await query({ name: "idle-detection" as PermissionName })).state : "prompt";
        if (state === "granted") {
          void startLockDetector();
        } else if (state === "prompt") {
          const askOnGesture = async () => {
            try {
              if ((await IdleDetector.requestPermission()) === "granted") void startLockDetector();
            } catch {
              /* user dismissed — fallback covers it */
            }
          };
          window.addEventListener("pointerdown", askOnGesture, { once: true });
          idleAbort.signal.addEventListener("abort", () => window.removeEventListener("pointerdown", askOnGesture));
        }
      } catch {
        /* permissions API unavailable — fallback covers it */
      }
    };
    void armLockDetection();

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
    // Note the tab BECOMING hidden is deliberately not a downgrade anymore:
    // working in another app/tab/screen keeps the agent online. The beat on
    // hide simply reports the unchanged status promptly.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        lastActivityRef.current = Date.now();
      }
      beat();
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

    // --- Tab closing: best-effort "offline" beacon, ONLY from the last tab.
    // Closing one of several Ziplod tabs used to beacon offline and flicker
    // the agent unassignable for up to a heartbeat interval while their other
    // tabs were still working.
    let closingHandled = false;
    const onTabClosing = () => {
      if (closingHandled) return;
      closingHandled = true;
      const wasLast = removeTabEntryAndCheckLast();
      if (wasLast) {
        navigator.sendBeacon?.(
          "/api/presence/heartbeat",
          new Blob([JSON.stringify({ status: "offline", sentAt: Date.now() })], { type: "application/json" })
        );
      }
    };
    window.addEventListener("pagehide", onTabClosing);
    window.addEventListener("beforeunload", onTabClosing);

    return () => {
      worker?.terminate();
      if (fallbackTimer) clearInterval(fallbackTimer);
      clearInterval(renew);
      idleAbort.abort();
      for (const ev of activityEvents) window.removeEventListener(ev, markActivity);
      window.removeEventListener("scroll", markActivity, { capture: true } as EventListenerOptions);
      window.removeEventListener("focus", beat);
      window.removeEventListener("online", beat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onTabClosing);
      window.removeEventListener("beforeunload", onTabClosing);
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
