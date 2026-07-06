"use client";

import { useEffect, useRef, useState } from "react";

const HEARTBEAT_INTERVAL_MS = 30_000;

type Status = "online" | "idle" | "busy" | "break";

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "busy", label: "Busy" },
  { value: "break", label: "Break" },
];

// Mounted once inside Sidebar for any company member (not super_admin —
// they don't take leads). Sends a heartbeat on mount + every 30s carrying
// whatever status the agent last picked (defaulting to "online"), so
// manually setting "Break" actually sticks instead of being overwritten by
// the next automatic tick. On tab close/navigation away, best-effort
// notifies the server via sendBeacon that they've gone offline — if that
// never arrives (browser killed, network cut), the server-side heartbeat
// timeout in src/lib/presence.ts is what guarantees the agent is still
// eventually marked unavailable, so this isn't relied on for correctness,
// only for faster-than-timeout accuracy.
export default function PresenceHeartbeat() {
  const [status, setStatus] = useState<Status>("online");
  const statusRef = useRef<Status>("online");

  useEffect(() => {
    const send = (currentStatus: Status) => {
      fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: currentStatus }),
        keepalive: true,
      }).catch(() => {
        // A missed heartbeat is expected to happen sometimes (a flaky
        // connection); the server-side timeout handles it, so there's
        // nothing to recover here beyond letting the next interval retry.
      });
    };

    send(statusRef.current);
    const interval = setInterval(() => send(statusRef.current), HEARTBEAT_INTERVAL_MS);

    const sendOfflineBeacon = () => {
      navigator.sendBeacon?.(
        "/api/presence/heartbeat",
        new Blob([JSON.stringify({ status: "offline" })], { type: "application/json" })
      );
    };
    window.addEventListener("beforeunload", sendOfflineBeacon);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", sendOfflineBeacon);
    };
  }, []);

  function selectStatus(next: Status) {
    setStatus(next);
    statusRef.current = next;
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
