// Internal event bus — an in-process typed pub/sub dispatcher. No Kafka,
// no external broker, as instructed: this is a Map of event name ->
// listener functions, exactly the same shape of abstraction as the job
// queue in src/lib/infra/queue.ts, and for the same reason: it gives every
// future consumer (notifications, workflows, reporting, eventually AI) one
// place to subscribe to "things that happened" instead of each of them
// needing to be called explicitly from inside route handlers.
//
// Listeners run synchronously, in registration order, awaited one at a
// time, from wherever `emit()` is called. A slow or failing listener does
// NOT stop other listeners from running (each is wrapped individually),
// but a slow listener DOES currently add to the request's latency, because
// there's no queue underneath this yet — emit() is called from inside HTTP
// request handlers today. That's an accepted, explicit tradeoff for this
// phase (no new async infrastructure), not an oversight; see the
// dead-letter-style logging below for how failures surface.
import { createLogger } from "../logger";

export type EventType =
  | "lead.created"
  | "lead.updated"
  | "lead.deleted"
  | "lead.assigned"
  | "lead.imported"
  | "lead.exported"
  // Assignment Engine lifecycle (Phase 1). These are additive and power
  // future analytics; `lead.assigned` is kept and still emitted on success
  // so existing notification/AI listeners are unaffected.
  | "lead.queued"
  | "assignment.started"
  | "assignment.candidate_selected"
  | "assignment.completed"
  | "assignment.failed"
  | "lead.recycled"
  | "lead.lifecycle_changed"
  | "lead.disposition_changed"
  | "lead.rebalanced"
  | "assignment.sla_breached"
  // Agent Presence Service lifecycle (Phase 2). Emitted only by the presence
  // service on an actual state TRANSITION, never on every heartbeat.
  | "presence.online"
  | "presence.offline"
  | "presence.away"
  | "presence.busy"
  | "presence.locked"
  | "presence.logged_out"
  | "presence.heartbeat_lost"
  | "presence.heartbeat_restored"
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "company.created"
  | "company.suspended"
  | "webhook.received"
  | "automation.triggered";

export type EventPayloads = {
  "lead.created": { leadId: string; companyId: string; source: "manual" | "import" | "webhook" };
  "lead.updated": { leadId: string; companyId: string; changedFields: string[] };
  "lead.deleted": { leadId: string; companyId: string };
  // actorUserId: who performed the assignment when it was a person (manual
  // assign / force-assign / direct edit); absent for the automatic engine.
  // Lets the client suppress the new-lead alert when someone assigns a lead
  // to themselves.
  "lead.assigned": { leadId: string; companyId: string; agentId: string; actorUserId?: string };
  "lead.imported": { companyId: string; createdCount: number; duplicateCount: number; skippedCount: number };
  "lead.exported": { companyId: string; count: number };
  "lead.queued": { leadId: string; companyId: string; source: string };
  "assignment.started": { leadId: string; companyId: string; source: string };
  "assignment.candidate_selected": { leadId: string; companyId: string; agentId: string; strategy: string };
  "assignment.completed": { leadId: string; companyId: string; agentId: string; strategy: string; processingTimeMs: number };
  "assignment.failed": { leadId: string; companyId: string; reason: string; attempt: number };
  "lead.recycled": { leadId: string; companyId: string; fromAgentId: string | null };
  "lead.lifecycle_changed": { leadId: string; companyId: string; from: string | null; to: string; reason: string | null };
  // Phase 11: emitted whenever a lead's disposition changes (the business
  // trigger the Conversions API maps to Meta events). `to` is the new
  // disposition label.
  "lead.disposition_changed": { leadId: string; companyId: string; from: string; to: string };
  "lead.rebalanced": { leadId: string; companyId: string; fromAgentId: string | null; toAgentId: string };
  "assignment.sla_breached": { leadId: string; companyId: string };
  "presence.online": { userId: string; companyId: string | null };
  "presence.offline": { userId: string; companyId: string | null };
  "presence.away": { userId: string; companyId: string | null };
  "presence.busy": { userId: string; companyId: string | null };
  "presence.locked": { userId: string; companyId: string | null };
  "presence.logged_out": { userId: string; companyId: string | null };
  "presence.heartbeat_lost": { userId: string; companyId: string | null };
  "presence.heartbeat_restored": { userId: string; companyId: string | null };
  "user.created": { userId: string; companyId: string; role: string };
  "user.updated": { userId: string; companyId: string };
  "user.deleted": { userId: string; companyId: string };
  "company.created": { companyId: string };
  "company.suspended": { companyId: string };
  "webhook.received": { companyId: string; sourceId: string; success: boolean };
  "automation.triggered": { companyId: string; ruleName: string };
};

export type EventListener<T extends EventType> = (payload: EventPayloads[T]) => Promise<void> | void;

export interface EventBus {
  on<T extends EventType>(type: T, listener: EventListener<T>): void;
  emit<T extends EventType>(type: T, payload: EventPayloads[T]): Promise<void>;
}

class InProcessEventBus implements EventBus {
  private listeners = new Map<EventType, EventListener<never>[]>();
  private logger = createLogger({ component: "event-bus" });

  on<T extends EventType>(type: T, listener: EventListener<T>): void {
    const existing = this.listeners.get(type) || [];
    existing.push(listener as EventListener<never>);
    this.listeners.set(type, existing);
  }

  async emit<T extends EventType>(type: T, payload: EventPayloads[T]): Promise<void> {
    const handlers = this.listeners.get(type) || [];
    this.logger.debug("event_emitted", { eventType: type, listenerCount: handlers.length });
    for (const handler of handlers) {
      try {
        await handler(payload as never);
      } catch (err) {
        // One listener failing must never break the others, or the code
        // that emitted the event in the first place (e.g. lead creation
        // shouldn't fail because a notification listener threw).
        this.logger.error("event_listener_failed", {
          eventType: type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

export const eventBus: EventBus = new InProcessEventBus();
