// Public surface of the Assignment Engine module.
//
// This replaces the old monolithic src/lib/assignment.ts. Its logic now lives
// in the pipeline + strategies + services under this directory, with the
// engine as the single entry point. This file keeps the OLD import surface
// working so nothing that imported "@/lib/assignment" has to change:
//   - assignLead()          — same signature, same return contract
//   - TERMINAL_DISPOSITIONS  — re-exported from ./constants
//   - the "lead.assign" job handler registration
//   - the lead.assigned listener side-effect imports
import { assignmentEngine } from "./engine";
import { queue } from "@/lib/infra/queue";
import type { AssignSource } from "./types";

export { TERMINAL_DISPOSITIONS } from "./constants";
export { assignmentEngine } from "./engine";
export { getAssignmentMetrics } from "./metrics";
export { listStrategies } from "./strategies";
// Phase 3 AI intelligence surface.
export { getAIConfig, updateAIConfig, getAIMetrics, DEFAULT_AI_CONFIG } from "./ai";
export type { AIScoringConfig, AIMetricsSnapshot } from "./ai";
// Phase 5 skills / capacity / SLA surface.
export { getRoutingMetrics, createOverride, clearOverride, getActiveOverrides } from "./ai";
export type { RoutingMetrics, OverrideType } from "./ai";
export { agentAvailability, toAvailabilityState, isAssignableState } from "./availability";
export type { AvailabilityState } from "./availability";
export type { AssignmentRequest, AssignmentResult, AssignmentOutcome, AssignSource } from "./types";

// Kept as a named type for any caller that referenced it off the old module.
export type AssignOptions = { source?: AssignSource };

// Side-effect imports preserved from the old assignment.ts: registering the
// lead.assigned listeners (in-app notification + AI recommendation) as a
// consequence of importing the engine, so they are wired exactly as before.
import "@/lib/notifications/listeners";
import "@/lib/ai/automation";
// Phase 9 Lead Insights: enqueue an ASYNC insight recompute on lead lifecycle
// events. Each listener only enqueues (O(1), non-blocking), so this adds zero
// latency to assignment — the recompute runs off-path (see lib/insights/queue).
import "@/lib/insights/listeners";
// Phase 11 Conversions API: enqueue an ASYNC Meta conversion send on lead
// create/assign/disposition-change. Same non-blocking guarantee — the
// Assignment Engine never waits for Meta (see lib/capi/queue).
import "@/lib/capi/listeners";

/**
 * Backward-compatible facade over the engine. Every existing caller keeps
 * this exact signature and contract: returns the chosen agent id, or null if
 * the lead was not assigned (no eligible agent, blacklisted, auto-assign off,
 * outside working hours, or a lost claim race). Internally this now flows
 * through the AssignmentEngine -> pipeline -> strategy, and records the full
 * event + history trail — but callers see no difference.
 */
export async function assignLead(
  leadId: string,
  companyId: string,
  requiredSkillId?: string | null,
  excludeAgentId?: string | null,
  options?: AssignOptions
): Promise<string | null> {
  const result = await assignmentEngine.assign({
    leadId,
    companyId,
    requiredSkillId,
    excludeAgentId,
    source: options?.source ?? "arrival",
  });
  return result.agentId;
}

// Same registration the old assignment.ts performed on import: guarantees the
// "lead.assign" job handler exists, so routes that go through
// queue.enqueue("lead.assign", ...) (e.g. manual lead creation) keep working
// unchanged. Today this runs inline; it becomes real async work the day the
// in-process JobQueue is swapped for a Redis-backed one — call sites untouched.
queue.register("lead.assign", async (payload) => {
  await assignLead(payload.leadId, payload.companyId, payload.requiredSkillId, payload.excludeAgentId);
});
