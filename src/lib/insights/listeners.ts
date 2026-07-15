// Phase 9 — wire the insight recompute to "things that happened". Every
// listener does exactly one thing: enqueue an async recompute (O(1)). None of
// them touch the database synchronously, so registering these adds ZERO latency
// to assignment or to any request that emits one of these events. Registered as
// a side effect of importing this file (see src/lib/assignment/index.ts, the
// same place the notification + AI-automation listeners are wired).
import { eventBus } from "@/lib/events/bus";
import { enqueueInsightsRecompute } from "./queue";

// A lead's insight depends on: whether/who it's assigned to, its lifecycle
// stage and disposition, recycles, and rebalances. Recompute on each.
eventBus.on("lead.created", (p) => enqueueInsightsRecompute(p.leadId));
eventBus.on("lead.assigned", (p) => enqueueInsightsRecompute(p.leadId));
eventBus.on("lead.queued", (p) => enqueueInsightsRecompute(p.leadId));
eventBus.on("lead.recycled", (p) => enqueueInsightsRecompute(p.leadId));
eventBus.on("lead.rebalanced", (p) => enqueueInsightsRecompute(p.leadId));
eventBus.on("lead.lifecycle_changed", (p) => enqueueInsightsRecompute(p.leadId));
eventBus.on("lead.updated", (p) => enqueueInsightsRecompute(p.leadId));
