"use client";

import { useEffect, useRef, useState } from "react";

const HEARTBEAT_INTERVAL_MS = 30_000;
// Shared across every tab of the same origin: the chosen status (so all
// tabs agree and don't fight) and a leader lease (so exactly one tab owns
// the heartbeat interval instead of N tabs each sending — the "multiple
// tabs" case the spec calls out).
const STATUS_KEY = "ziplod_presence_status";
const LEADER_KEY = "ziplod_presence_leader";
const LEADER_TTL_MS = 12_000; // a leader lease older than this is stale (tab closed/crashed) and can be claimed
const LEADER_RENEW_MS = 5_000;

// Manually selectable states. Offline/locked/idle/disconnected/heartbeat-lost
// are NOT here: offline is sent automatically on tab close, and the other
// three are derived server-side from heartbeat staleness (a crashed or
// locked machine can't self-report — the missing heartbeat is the signal).
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

// Mounted once inside Sidebar for any company member (not super_admin — they
// don't take leads). One tab (the leader) heartbeats every 30s carrying the
// shared status; every tab beats immediately on regaining focus/visibility/
// network so a laptop waking from sleep, a reconnecting network, or an
// unlocked machine is marked available again within a second instead of
// waiting out the server-side timeout. On tab close it best-effort beacons
// "offline"; if that never arrives (browser killed, power lost), the
// server-side heartbeat timeout is what guarantees correctness.
export default function PresenceHeartbeat() {
  const [status, setStatus] = useState<Status>("online");
  const statusRef = useRef<Status>("online");
  const tabId = useRef<string>(Math.random().toString(36).slice(2) + Date.now().toString(36));

  useEffect(() => {
    // Sync initial status from any tab that already picked one.
    const initial = readStatus();
    statusRef.current = initial;
    setStatus(initial);

    const send = (currentStatus: Status) => {
      fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: currentStatus }),
        keepalive: true,
      }).catch(() => {
        // A missed heartbeat is expected sometimes (flaky connection); the
        // server-side timeout handles it and the next tick/focus retries.
      });
    };

    // --- Leader election: exactly one tab owns the periodic heartbeat ---
    const isLeader = (): boolean => {
      try {
        const raw = window.localStorage.getItem(LEADER_KEY);
        if (!raw) return false;
        const { id } = JSON.parse(raw) as { id: string; ts: number };
        return id === tabId.current;
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
          // Someone else holds a fresh lease — leave it alone.
          if (lease.id !== tabId.current && now - lease.ts < LEADER_TTL_MS) return;
        }
        window.localStorage.setItem(LEADER_KEY, JSON.stringify({ id: tabId.current, ts: now }));
      } catch {
        // localStorage unavailable (private mode edge cases) — every tab
        // just heartbeats itself; harmless duplication, still correct.
      }
    };

    tryClaimLeadership();
    send(statusRef.current); // one immediate beat on mount regardless of leadership

    const heartbeat = setInterval(() => {
      tryClaimLeadership();
      // Only the leader sends the periodic beat; if localStorage is blocked,
      // isLeader() is false everywhere so every tab falls back to sending —
      // still correct, just not deduped.
      if (isLeader() || !window.localStorage.getItem(LEADER_KEY)) {
        send(statusRef.current);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Renew the leader lease more often than the heartbeat so a dead leader
    // is taken over within ~a lease TTL, not a full heartbeat interval.
    const renew = setInterval(() => {
      if (isLeader()) tryClaimLeadership();
      else tryClaimLeadership(); // claims only if the current lease is stale
    }, LEADER_RENEW_MS);

    // --- Fast recovery: beat immediately when the tab regains the ability
    // to reach the network (wake from sleep, unlock, tab refocus, reconnect) ---
    const beatNow = () => send(statusRef.current);
    const onVisibility = () => {
      if (document.visibilityState === "visible") beatNow();
    };
    const onStorage = (e: StorageEvent) => {
      // Another tab changed the shared status — reflect it here so the
      // dropdown stays consistent across tabs.
      if (e.key === STATUS_KEY && e.newValue && (VALID as string[]).includes(e.newValue)) {
        statusRef.current = e.newValue as Status;
        setStatus(e.newValue as Status);
      }
    };
    window.addEventListener("focus", beatNow);
    window.addEventListener("online", beatNow);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);

    // --- Tab closing: best-effort "offline" beacon. pagehide is more
    // reliable than beforeunload (fires on mobile/bfcache); both are wired. ---
    const sendOfflineBeacon = () => {
      navigator.sendBeacon?.(
        "/api/presence/heartbeat",
        new Blob([JSON.stringify({ status: "offline" })], { type: "application/json" })
      );
    };
    window.addEventListener("pagehide", sendOfflineBeacon);
    window.addEventListener("beforeunload", sendOfflineBeacon);

    return () => {
      clearInterval(heartbeat);
      clearInterval(renew);
      window.removeEventListener("focus", beatNow);
      window.removeEventListener("online", beatNow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", sendOfflineBeacon);
      window.removeEventListener("beforeunload", sendOfflineBeacon);
    };
  }, []);

  function selectStatus(next: Status) {
    setStatus(next);
    statusRef.current = next;
    try {
      window.localStorage.setItem(STATUS_KEY, next); // shared across tabs
    } catch {
      /* ignore */
    }
    fetch("/api/presence/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
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
