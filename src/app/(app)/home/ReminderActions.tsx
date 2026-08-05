"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// "Reminder Done" (and Dismiss). Marks the reminder resolved server-side, then
// refreshes the server component so it drops off the list.
export function ReminderActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(status: "completed" | "dismissed") {
    setBusy(true);
    try {
      await fetch(`/api/sales/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      /* best-effort; the refresh will reflect the real state */
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        disabled={busy}
        onClick={() => act("completed")}
        className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md px-3 py-1.5 disabled:opacity-50"
      >
        ✓ Reminder Done
      </button>
      <button
        disabled={busy}
        onClick={() => act("dismissed")}
        className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-50"
      >
        Dismiss
      </button>
    </div>
  );
}
