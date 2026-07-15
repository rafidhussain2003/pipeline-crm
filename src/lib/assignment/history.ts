// Assignment decision persistence. Writes TWO stores:
//
//  1. assignment_history (new) — the permanent, richer decision record the
//     spec asks for: candidate pool, strategy, processing time, attempt
//     number, failure reason. Feeds future AI/analytics. Never read by
//     existing code, so writing it can't break anything.
//
//  2. assignment_log (existing) — kept and written with the SAME semantics
//     the old engine used, because the Team dashboard, lead timeline,
//     performance report and AI context all read it. Backward compatibility.
//
// Retry-storm protection: sweep/queue RETRIES of the same unplaceable leads
// must not flood either table. Only decisions from a lead's arrival or a
// manual action persist a non-success row; a successful placement and a
// lost-claim race always persist (they happen at most once per lead).
import { db } from "@/db";
import { assignmentHistory, assignmentLog } from "@/db/schema";
import type { AssignmentOutcome, AssignmentResult, AssignSource } from "./types";

// outcome -> the legacy assignment_log.status vocabulary. `null` means "the
// old engine wrote no log row for this case" (blacklist / auto-assign off).
function legacyLogStatus(outcome: AssignmentOutcome): "assigned" | "failed" | "skipped" | null {
  switch (outcome) {
    case "assigned":
      return "assigned";
    case "claim_lost":
      return "skipped";
    case "no_eligible_agent":
    case "error":
      return "failed";
    case "skipped":
      return null;
  }
}

export async function recordDecision(params: {
  leadId: string;
  companyId: string;
  source: AssignSource;
  attempt: number;
  result: AssignmentResult;
}): Promise<void> {
  const { leadId, companyId, source, attempt, result } = params;
  const { outcome } = result;

  // A success or a lost-claim race is a once-per-lead fact — always persist.
  // Everything else only persists at arrival/manual, never on sweep/queue
  // retries (which re-touch the same backlog every cycle).
  const alwaysPersist = outcome === "assigned" || outcome === "claim_lost";
  const persist = alwaysPersist || source === "arrival" || source === "manual";
  if (!persist) return;

  const isSuccess = outcome === "assigned";

  // Permanent rich record (new table).
  await db.insert(assignmentHistory).values({
    companyId,
    leadId,
    assignedTo: result.agentId,
    outcome,
    strategyUsed: result.strategy,
    candidateIds: result.candidateIds,
    candidateCount: result.candidateIds.length,
    presenceStatus: result.presenceStatus,
    processingTimeMs: result.processingTimeMs,
    attempt,
    source,
    failureReason: isSuccess ? null : result.reason,
    // Phase 3 AI audit — the chosen agent's score + the full decision
    // breakdown (per-factor scores, scored + rejected candidates). Null for
    // non-AI strategies.
    finalScore: result.finalScore ?? null,
    decisionDetail: result.decisionDetail ?? null,
  });

  // Backward-compatible log row (existing table + readers).
  const status = legacyLogStatus(outcome);
  if (status) {
    await db.insert(assignmentLog).values({
      leadId,
      assignedTo: result.agentId,
      status,
      ruleUsed: result.strategy,
      presenceStatus: result.presenceStatus,
      latencyMs: result.processingTimeMs,
      reason: result.reason,
    });
  }
}
