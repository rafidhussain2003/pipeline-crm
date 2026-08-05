"use client";

import { useEffect, useRef } from "react";

// Slides the 1-hour PIN unlock window forward on GENUINE activity. Pings the
// touch route at most once every 5 minutes when the user clicks/types or the
// tab becomes visible. If the user is truly idle (tab closed, computer asleep,
// no interaction) no pings go out, so the unlock cookie lapses after ~1h and
// the PIN is asked again on return. Mounted only for users who have a PIN.
export function PinKeepAlive() {
  const last = useRef(0);

  useEffect(() => {
    // Baseline the throttle at mount (Date.now() is only safe outside render).
    last.current = Date.now();
    const ping = () => {
      const now = Date.now();
      if (now - last.current < 5 * 60 * 1000) return; // at most once / 5 min
      last.current = now;
      fetch("/api/auth/pin/touch", { method: "POST", keepalive: true }).catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    window.addEventListener("click", ping);
    window.addEventListener("keydown", ping);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("click", ping);
      window.removeEventListener("keydown", ping);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
