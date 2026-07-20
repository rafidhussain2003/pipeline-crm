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
  type: "lead.created";
  leadId: string;
  companyId: string;
  source: "manual" | "import" | "webhook";
  at: string; // ISO
};

// Owner changed (manual assign, supervisor force-assign, automatic engine).
// Same signal-not-data discipline as arrivals: ids only, the client re-runs
// its own query to see the new owner.
export type LeadAssignedSignal = {
  type: "lead.assigned";
  leadId: string;
  companyId: string;
  agentId: string;
  at: string; // ISO
};

export type LeadStreamSignal = NewLeadSignal | LeadAssignedSignal;

type Listener = (signal: LeadStreamSignal) => void;

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

  publish(signal: LeadStreamSignal): void {
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
      type: "lead.created",
      leadId: p.leadId,
      companyId: p.companyId,
      source: p.source,
      at: new Date().toISOString(),
    });
  });
  // Owner changes ride the same hub/stream. "lead.assigned" is emitted by
  // every assignment path — automatic engine, manual bulk assign, the
  // leads/[id] PATCH — so an open leads page sees ownership move live no
  // matter which path changed it.
  eventBus.on("lead.assigned", (p) => {
    leadStreamHub.publish({
      type: "lead.assigned",
      leadId: p.leadId,
      companyId: p.companyId,
      agentId: p.agentId,
      at: new Date().toISOString(),
    });
  });
}
