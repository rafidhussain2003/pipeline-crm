// The Assignment Engine — the single component responsible for assigning
// leads. Every path in the app (live Meta webhook, historical import,
// website form, manual creation, CSV import, supervisor action, recycle,
// queue worker) reaches assignment through here; no route selects an agent
// or writes leads.owner_id on its own anymore.
//
// Two entry points, ONE pipeline:
//   assign()  — run the decision inline and return the outcome. This is what
//               every existing caller needs, so their behavior is preserved
//               exactly (the facade assignLead() wraps this).
//   enqueue() — durably queue the lead for asynchronous processing by the
//               worker. Non-blocking; the distributed-ready path for new
//               callers and for failure recovery.
import { runPipeline } from "./pipeline";
import { assignmentQueue, kickJobWorker, processDueJobs } from "./job-queue";
import { transitionLifecycle } from "@/lib/lifecycle/service";
import type { AssignmentRequest, AssignmentResult } from "./types";

export interface AssignmentEngine {
  assign(request: AssignmentRequest): Promise<AssignmentResult>;
  enqueue(request: AssignmentRequest): Promise<void>;
  processQueue(limit?: number): Promise<{ processed: number; assigned: number }>;
}

class DefaultAssignmentEngine implements AssignmentEngine {
  async assign(request: AssignmentRequest): Promise<AssignmentResult> {
    const result = await runPipeline(request);

    // Failure recovery: a genuinely unassigned lead that couldn't be placed
    // right now is durably queued, so it is retried with backoff and bounded
    // attempts — never lost, never retried forever. Gated on !excludeAgentId
    // so a REASSIGNMENT attempt of an already-owned lead (recycle /
    // force-recycle pass the current owner to exclude) never spawns a spurious
    // "unassigned" job — that lead still has its owner. Idempotent regardless
    // (one live job per lead). Phase 17: also gated off for "progressive" —
    // a release-cycle miss needs no durable retry job (the lead stays in the
    // backlog and the NEXT cycle simply picks it up; a job would only bounce
    // off the pipeline's progressive gate anyway).
    if (result.outcome === "no_eligible_agent" && !request.excludeAgentId && request.source !== "progressive") {
      await assignmentQueue.enqueue({
        leadId: request.leadId,
        companyId: request.companyId,
        requiredSkillId: request.requiredSkillId ?? null,
        excludeAgentId: request.excludeAgentId ?? null,
        source: request.source ?? "arrival",
      });
      // Phase 4: a fresh lead that couldn't be placed enters the QUEUED
      // lifecycle stage. onlyFrom "new" so a lead already queued/recycled isn't
      // re-logged, and a reassignment attempt never regresses an active lead.
      await transitionLifecycle({
        leadId: request.leadId,
        companyId: request.companyId,
        toStage: "queued",
        reason: "queued:no_eligible_agent",
        onlyFrom: ["new"],
      });
    }
    return result;
  }

  async enqueue(request: AssignmentRequest): Promise<void> {
    await assignmentQueue.enqueue({
      leadId: request.leadId,
      companyId: request.companyId,
      requiredSkillId: request.requiredSkillId ?? null,
      excludeAgentId: request.excludeAgentId ?? null,
      source: request.source ?? "arrival",
    });
    // Event-driven drain — the worker wakes now, processes what's due, stops.
    kickJobWorker();
  }

  async processQueue(limit = 50): Promise<{ processed: number; assigned: number }> {
    return processDueJobs(limit);
  }
}

export const assignmentEngine: AssignmentEngine = new DefaultAssignmentEngine();
