// Phase 11 — wire CAPI event sending to CRM lifecycle changes. Each listener
// only calls enqueueCapiForLead (O(1), deferred, non-blocking), so the
// Assignment Engine and every request that emits one of these events NEVER
// waits for Meta. Registered as an import side effect (see the assignment
// bootstrap), the same way the insight + notification listeners are.
import { eventBus } from "@/lib/events/bus";
import { enqueueCapiForLead } from "./queue";

eventBus.on("lead.created", (p) => enqueueCapiForLead(p.leadId, "lead_created"));
eventBus.on("lead.assigned", (p) => enqueueCapiForLead(p.leadId, "lead_assigned"));
// The disposition IS the business trigger (New Lead / Qualified / Sold / …).
eventBus.on("lead.disposition_changed", (p) => enqueueCapiForLead(p.leadId, p.to));
