// Phase 15 — per-USER real-time fan-out for callback reminders. Same proven
// in-process pub/sub shape as the Operations Center's activityHub (which is
// per-COMPANY); this one is keyed by userId because a callback reminder belongs
// to one agent. The SSE route subscribes; the reminder worker publishes.
//
// No polling anywhere: the client opens one EventSource and the server pushes.
// A Redis pub/sub fan-out slots in behind this class later for multi-instance
// without changing the route or the worker.
import type { CallbackReminderPayload } from "./types";

class CallbackHub {
  private subscribers = new Map<string, Set<(p: CallbackReminderPayload) => void>>();

  publish(userId: string, payload: CallbackReminderPayload): void {
    const subs = this.subscribers.get(userId);
    if (!subs) return;
    for (const cb of subs) {
      try {
        cb(payload);
      } catch {
        /* one dead stream must never break the others */
      }
    }
  }

  subscribe(userId: string, cb: (p: CallbackReminderPayload) => void): () => void {
    let set = this.subscribers.get(userId);
    if (!set) {
      set = new Set();
      this.subscribers.set(userId, set);
    }
    set.add(cb);
    return () => {
      const s = this.subscribers.get(userId);
      if (s) {
        s.delete(cb);
        if (s.size === 0) this.subscribers.delete(userId);
      }
    };
  }

  // Observability: how many live listeners this instance holds.
  listenerCount(userId?: string): number {
    if (userId) return this.subscribers.get(userId)?.size ?? 0;
    let n = 0;
    for (const s of this.subscribers.values()) n += s.size;
    return n;
  }
}

export const callbackHub = new CallbackHub();
