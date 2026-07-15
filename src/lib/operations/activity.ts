// Operations Center — live activity hub.
//
// The real-time feed backbone. It SUBSCRIBES to the existing in-process event
// bus (it does not add new events anywhere — nothing in lead flow / presence /
// assignment is modified) and turns each relevant event into a compact
// activity item, kept in a bounded per-company ring buffer and fanned out to
// any connected SSE streams for that company.
//
// Everything here is in-memory and synchronous: the bus emits from inside the
// assignment hot path, so a listener that touched the DB would add latency to
// assignment. Instead an item is just pushed to a buffer + written to open
// streams (userId/agentId are carried as ids; the UI resolves names from the
// snapshot it already has, so no lookup happens here).
import { eventBus } from "@/lib/events/bus";

export type ActivityType =
  | "lead.new"
  | "lead.assigned"
  | "lead.queued"
  | "lead.recycled"
  | "lead.rebalanced"
  | "lead.escalated"
  | "lead.won"
  | "lead.lost"
  | "lead.closed"
  | "lead.contacted"
  | "agent.online"
  | "agent.offline"
  | "agent.logged_out"
  | "agent.busy"
  | "agent.away"
  | "agent.locked"
  | "agent.connection_lost"
  | "agent.reconnected";

export interface ActivityItem {
  id: string;
  companyId: string;
  type: ActivityType;
  label: string;
  // ids the UI can resolve to names from the snapshot it already holds.
  agentId?: string | null;
  leadId?: string | null;
  at: string; // ISO
}

const BUFFER_PER_COMPANY = 100;

class ActivityHub {
  private buffers = new Map<string, ActivityItem[]>();
  private subscribers = new Map<string, Set<(item: ActivityItem) => void>>();
  private seq = 0;

  record(companyId: string, type: ActivityType, label: string, extra: { agentId?: string | null; leadId?: string | null } = {}): void {
    if (!companyId) return;
    const item: ActivityItem = {
      id: `${Date.now()}-${this.seq++}`,
      companyId,
      type,
      label,
      agentId: extra.agentId ?? null,
      leadId: extra.leadId ?? null,
      at: new Date().toISOString(),
    };
    const buf = this.buffers.get(companyId) ?? [];
    buf.unshift(item); // newest first
    if (buf.length > BUFFER_PER_COMPANY) buf.length = BUFFER_PER_COMPANY;
    this.buffers.set(companyId, buf);

    const subs = this.subscribers.get(companyId);
    if (subs) for (const cb of subs) { try { cb(item); } catch { /* a dead stream must never break others */ } }
  }

  getRecent(companyId: string, limit = 50): ActivityItem[] {
    return (this.buffers.get(companyId) ?? []).slice(0, limit);
  }

  subscribe(companyId: string, cb: (item: ActivityItem) => void): () => void {
    let set = this.subscribers.get(companyId);
    if (!set) { set = new Set(); this.subscribers.set(companyId, set); }
    set.add(cb);
    return () => {
      const s = this.subscribers.get(companyId);
      if (s) { s.delete(cb); if (s.size === 0) this.subscribers.delete(companyId); }
    };
  }
}

export const activityHub = new ActivityHub();

// Register the bus listeners exactly once (idempotent — the module may be
// imported by both API routes).
let registered = false;
export function ensureActivityListeners(): void {
  if (registered) return;
  registered = true;

  // A genuinely new lead entering the system: the FIRST assignment attempt
  // (source "arrival"). Sweep/queue retries reuse this event but are filtered
  // out here so the feed only shows real arrivals.
  eventBus.on("assignment.started", (p) => {
    if (p.source === "arrival") activityHub.record(p.companyId, "lead.new", "New lead received", { leadId: p.leadId });
  });
  eventBus.on("lead.assigned", (p) => activityHub.record(p.companyId, "lead.assigned", "Lead assigned", { leadId: p.leadId, agentId: p.agentId }));
  eventBus.on("lead.queued", (p) => activityHub.record(p.companyId, "lead.queued", "Lead queued (waiting for an agent)", { leadId: p.leadId }));
  eventBus.on("lead.recycled", (p) => activityHub.record(p.companyId, "lead.recycled", "Lead recycled", { leadId: p.leadId, agentId: p.fromAgentId }));
  eventBus.on("lead.rebalanced", (p) => activityHub.record(p.companyId, "lead.rebalanced", "Lead rebalanced to another agent", { leadId: p.leadId, agentId: p.toAgentId }));
  eventBus.on("assignment.sla_breached", (p) => activityHub.record(p.companyId, "lead.escalated", "Lead escalated (SLA breach)", { leadId: p.leadId }));
  eventBus.on("lead.lifecycle_changed", (p) => {
    if (p.to === "won") activityHub.record(p.companyId, "lead.won", "Lead won", { leadId: p.leadId });
    else if (p.to === "lost") activityHub.record(p.companyId, "lead.lost", "Lead lost", { leadId: p.leadId });
    else if (p.to === "closed") activityHub.record(p.companyId, "lead.closed", "Lead closed", { leadId: p.leadId });
    else if (p.to === "contacted") activityHub.record(p.companyId, "lead.contacted", "Lead contacted", { leadId: p.leadId });
  });

  // Presence events (companyId + userId on each).
  const presence: Record<string, [ActivityType, string]> = {
    "presence.online": ["agent.online", "Agent came online"],
    "presence.offline": ["agent.offline", "Agent went offline"],
    "presence.logged_out": ["agent.logged_out", "Agent logged out"],
    "presence.busy": ["agent.busy", "Agent became busy"],
    "presence.away": ["agent.away", "Agent went away"],
    "presence.locked": ["agent.locked", "Agent locked their computer"],
    "presence.heartbeat_lost": ["agent.connection_lost", "Agent connection lost"],
    "presence.heartbeat_restored": ["agent.reconnected", "Agent reconnected"],
  };
  for (const [event, [type, label]] of Object.entries(presence)) {
    eventBus.on(event as "presence.online", (p) => {
      if (p.companyId) activityHub.record(p.companyId, type, label, { agentId: p.userId });
    });
  }
}
