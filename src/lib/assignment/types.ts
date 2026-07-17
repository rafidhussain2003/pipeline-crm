import type { PresenceStatus } from "@/lib/presence";

// Where an assignment attempt originated. Controls two things: whether a
// failed attempt is persisted (only arrival/manual persist a failure row —
// sweep/queue retries the same leads repeatedly and must not flood the
// history), and the label recorded for analytics.
// "progressive" (Phase 17) = a release cycle of the Progressive Lead Release
// engine; persisted like sweep/queue (successes recorded, retries not).
export type AssignSource = "arrival" | "sweep" | "manual" | "queue" | "recycle" | "progressive";

// The result of one assignment DECISION, regardless of how it was invoked.
export type AssignmentOutcome =
  | "assigned" // a candidate was chosen and the lead was atomically claimed
  | "no_eligible_agent" // nobody available right now — lead stays queued, will retry
  | "claim_lost" // another concurrent caller claimed this lead first (no double-assign)
  | "skipped" // intentionally not assigned (blacklisted / auto-assign off / outside hours)
  | "error"; // an unexpected failure while processing

export interface AssignmentRequest {
  leadId: string;
  companyId: string;
  requiredSkillId?: string | null;
  excludeAgentId?: string | null;
  source?: AssignSource;
  // Retry bookkeeping for the durable queue path — the pipeline itself is
  // stateless about attempts; the job row owns that count and passes it in
  // so history records the real attempt number.
  attempt?: number;
  // Phase 17: restrict the candidate pool to these agents (the Progressive
  // Release engine passes the agents who still hold batch allowance this
  // cycle). Absent/undefined = today's behavior, byte-for-byte — every other
  // caller is untouched. The pipeline still applies ALL its own gates on top
  // (presence, skill, workload, strategy), so this can only narrow, never
  // bypass, the existing rules.
  allowedAgentIds?: string[];
}

export interface AssignmentResult {
  outcome: AssignmentOutcome;
  agentId: string | null;
  strategy: string | null;
  candidateIds: string[];
  presenceStatus: PresenceStatus | null;
  processingTimeMs: number;
  // Human-readable detail: which pool the agent was picked from, why an
  // attempt failed, etc. Mirrors the old assignment_log.reason semantics.
  reason: string;
  // Phase 3 (AI): the chosen agent's composite score and the full decision
  // breakdown. Undefined for non-AI strategies (persisted as null).
  finalScore?: number | null;
  decisionDetail?: DecisionDetail | null;
}

// AI decision explainability + training data (Phase 3). A neutral shape so the
// history writer can persist it without importing the AI module. Populated by
// the AI strategy; null for every other strategy.
export interface DecisionFactorScore {
  factor: string;
  score: number;
  weight: number;
  weighted: number;
}
export interface DecisionCandidateScore {
  agentId: string;
  score: number;
  factors: DecisionFactorScore[];
}
export interface DecisionDetail {
  strategy: string; // "ai" | "ai:override" | "ai:fallback:<reason>"
  aiEnabled: boolean;
  chosen: { agentId: string; score: number; topReasons: string[] } | null;
  scored: DecisionCandidateScore[]; // every scored candidate (training data)
  rejected: { agentId: string; reason: string }[]; // gated-out candidates + why
  overrideApplied: boolean;
  durationMs: number;
}

// The eligibility-filtered agent the strategies choose among. Identical
// shape to what the old monolithic assignLead() built, so selection
// behavior is byte-for-byte preserved.
export interface CandidateAgent {
  id: string;
  tier: string | null;
  presenceStatus: PresenceStatus;
  lastHeartbeatAt: Date | null;
  lastAssignedAt: Date | null;
}
