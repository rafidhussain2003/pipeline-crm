// Phase 1B — fan-out of "a new lead exists" to open CRM browser tabs.
//
// Mirrors lib/operations/activity.ts deliberately: eventBus.on() has NO
// unsubscribe, so registering a listener per SSE connection would leak one
// listener per reconnect, forever. Instead the bus is subscribed exactly once
// and connections attach/detach to a plain Set here.
//
// Bound to "lead.created" rather than the activity hub's "lead.new" (which is
// derived from assignment.started): assignment can be disabled per company, and
// a CRM that stops showing new leads because auto-assign was turned off would be
// a nasty surprise. lead.created is emitted unconditionally by ingestLead the
// moment the row exists, for every source.
import { eventBus } from "@/lib/events/bus";

export type NewLeadSignal = {
  leadId: string;
  companyId: string;
  source: "manual" | "import" | "webhook";
  at: string; // ISO
};

type Listener = (signal: NewLeadSignal) => void;

class LeadStreamHub {
  private subscribers = new Map<string, Set<Listener>>();

  subscribe(companyId: string, cb: Listener): () => void {
    let set = this.subscribers.get(companyId);
    if (!set) {
      set = new Set();
      this.subscribers.set(companyId, set);
    }
    set.add(cb);
    // Returned disposer must be idempotent — React StrictMode double-invokes
    // effect cleanups in development.
    return () => {
      const s = this.subscribers.get(companyId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.subscribers.delete(companyId);
    };
  }

  publish(signal: NewLeadSignal): void {
    const subs = this.subscribers.get(signal.companyId);
    if (!subs) return;
    // One dead stream must never break the others — same discipline as the
    // activity hub's fan-out.
    for (const cb of subs) {
      try {
        cb(signal);
      } catch {
        /* ignore */
      }
    }
  }

  /** Open connection count for a company. Test/diagnostic use only. */
  subscriberCount(companyId: string): number {
    return this.subscribers.get(companyId)?.size ?? 0;
  }
}

export const leadStreamHub = new LeadStreamHub();

// Registered once per process, however many routes import this module.
let registered = false;
export function ensureLeadStreamListener(): void {
  if (registered) return;
  registered = true;
  eventBus.on("lead.created", (p) => {
    leadStreamHub.publish({
      leadId: p.leadId,
      companyId: p.companyId,
      source: p.source,
      at: new Date().toISOString(),
    });
  });
}
