// Thin, typed emitters for the assignment lifecycle. Centralizes the
// vocabulary the pipeline emits so callers (and future analytics consumers)
// have one import surface instead of scattering eventBus.emit("assignment.*")
// string literals through the pipeline. Every emit is fire-and-safe: the bus
// isolates listener failures, so emitting an event can never fail an
// assignment.
import { eventBus } from "@/lib/events/bus";
import type { AssignSource } from "./types";

export const assignmentEvents = {
  started(leadId: string, companyId: string, source: AssignSource) {
    return eventBus.emit("assignment.started", { leadId, companyId, source });
  },
  queued(leadId: string, companyId: string, source: AssignSource) {
    return eventBus.emit("lead.queued", { leadId, companyId, source });
  },
  candidateSelected(leadId: string, companyId: string, agentId: string, strategy: string) {
    return eventBus.emit("assignment.candidate_selected", { leadId, companyId, agentId, strategy });
  },
  completed(leadId: string, companyId: string, agentId: string, strategy: string, processingTimeMs: number) {
    return eventBus.emit("assignment.completed", { leadId, companyId, agentId, strategy, processingTimeMs });
  },
  failed(leadId: string, companyId: string, reason: string, attempt: number) {
    return eventBus.emit("assignment.failed", { leadId, companyId, reason, attempt });
  },
  recycled(leadId: string, companyId: string, fromAgentId: string | null) {
    return eventBus.emit("lead.recycled", { leadId, companyId, fromAgentId });
  },
};
