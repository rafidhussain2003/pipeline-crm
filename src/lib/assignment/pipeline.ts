// The assignment pipeline — the isolated, ordered steps that turn "assign
// this lead" into a decision. This is a faithful refactor of the original
// monolithic assignLead(): every filter, order, tie-break, cache key, metric
// and the atomic claim are preserved byte-for-byte, so routing OUTCOMES are
// identical — what changed is only the SHAPE (isolated steps behind the
// engine, strategies, availability service, events, history), which is what
// makes each future rule pluggable without rewriting the core.
//
// Steps: validate lead -> load company -> load available agents -> select
// strategy -> choose candidate -> persist (atomic claim) -> emit events ->
// finish (history + metrics). The pipeline is stateless about retries; the
// durable queue owns attempt counting and passes it in for history.
import { db } from "@/db";
import { assignmentRules, automationSettings, leads, users, userSkills } from "@/db/schema";
import { and, count, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { lock } from "@/lib/infra/lock";
import { eventBus } from "@/lib/events/bus";
import { metrics } from "@/lib/infra/metrics";
import { createLogger } from "@/lib/logger";
import { TERMINAL_DISPOSITIONS } from "./constants";
import { agentAvailability } from "./availability";
import { resolveStrategy } from "./strategies";
import { assignmentEvents } from "./events";
import { recordDecision } from "./history";
import { warmAIContext } from "./ai/strategy";
import { parseLeadRequirements } from "./ai/skills";
import { recordStageEvent } from "@/lib/lifecycle/service";
import type { LifecycleStage } from "@/lib/lifecycle/stages";
import { getProgressiveConfig } from "./progressive/config";
import { featureService } from "@/lib/features";
import type { AssignmentOutcome, AssignmentRequest, AssignmentResult, AssignSource, CandidateAgent, DecisionDetail } from "./types";

function nowMinuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// Supports overnight windows (start > end wraps past midnight), same as the
// original.
function withinWorkingHours(nowMinute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute <= endMinute) return nowMinute >= startMinute && nowMinute < endMinute;
  return nowMinute >= startMinute || nowMinute < endMinute;
}

// automation_settings + assignment_rules change only when an admin edits
// Settings, but are read on every assignment — cache-aside with the SAME keys
// the settings/rules PATCH routes invalidate on write, so an edit takes
// effect immediately rather than waiting out the 30s TTL.
async function loadSettings(companyId: string) {
  return cache.getOrSet(`automation-settings:${companyId}`, 30_000, async () => {
    const [row] = await db.select().from(automationSettings).where(eq(automationSettings.companyId, companyId)).limit(1);
    return row ?? null;
  });
}
async function loadRules(companyId: string) {
  return cache.getOrSet(`assignment-rules:${companyId}`, 30_000, async () =>
    db.select().from(assignmentRules).where(and(eq(assignmentRules.companyId, companyId), eq(assignmentRules.active, true)))
  );
}

function result(
  outcome: AssignmentOutcome,
  startedAt: number,
  opts: {
    agentId?: string | null;
    strategy?: string | null;
    candidateIds?: string[];
    presenceStatus?: CandidateAgent["presenceStatus"] | null;
    reason: string;
    finalScore?: number | null;
    decisionDetail?: DecisionDetail | null;
  }
): AssignmentResult {
  return {
    outcome,
    agentId: opts.agentId ?? null,
    strategy: opts.strategy ?? null,
    candidateIds: opts.candidateIds ?? [],
    presenceStatus: opts.presenceStatus ?? null,
    processingTimeMs: Date.now() - startedAt,
    reason: opts.reason,
    finalScore: opts.finalScore ?? null,
    decisionDetail: opts.decisionDetail ?? null,
  };
}

// The pure decision — no persistence, no lifecycle events; those are done by
// runPipeline() around it so the per-company lock is held for the minimum
// time (exactly the original's "emit after the lock releases" discipline).
async function decide(
  request: AssignmentRequest,
  source: AssignSource,
  startedAt: number,
  logger: ReturnType<typeof createLogger>
): Promise<AssignmentResult> {
  const { leadId, companyId, requiredSkillId, excludeAgentId } = request;

  // STEP 2 (company gate): auto-assign toggle.
  const settings = await loadSettings(companyId);
  if (settings && !settings.autoAssignEnabled) {
    logger.debug("assignment_skipped", { reason: "auto_assign_disabled" });
    return result("skipped", startedAt, { reason: "auto_assign_disabled" });
  }

  // Phase 17 gate: when Progressive Lead Release is ON, BACKLOG paths defer to
  // the release engine — a queued-job retry draining at 9am must not hand the
  // whole overnight backlog to the first agent, bypassing the pacing/reserve.
  // Only retry contexts are gated: "arrival" (fresh lead, speed-to-lead),
  // "manual" (a human's explicit action) and "recycle" (re-routing an owned
  // lead) stay immediate. Release-cycle calls carry allowedAgentIds and pass.
  if ((source === "queue" || source === "sweep") && !request.allowedAgentIds) {
    const progressive = await getProgressiveConfig(companyId);
    // Phase 18: the module must be ENTITLED too — this must mirror the sweep's
    // own branch exactly, or a company with progressive config ON but the
    // feature disabled would have the full drain skip here while no release
    // engine runs either, stranding the backlog.
    if (progressive.enabled && (await featureService.isEnabled(companyId, "progressive_lead_release"))) {
      logger.debug("assignment_skipped", { reason: "progressive_release_active" });
      return result("skipped", startedAt, { reason: "progressive_release_active" });
    }
  }

  // STEP 1: Validate lead (blacklist gate — never auto-assigned).
  const [leadRow] = await db
    .select({
      priority: leads.priority,
      isBlacklisted: leads.isBlacklisted,
      lifecycleStage: leads.lifecycleStage,
      skillRequirements: leads.skillRequirements,
      requiredSkillId: leads.requiredSkillId,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (leadRow?.isBlacklisted) {
    metrics.increment("assignment.skipped_blacklisted");
    logger.info("assignment_skipped", { reason: "lead_blacklisted" });
    return result("skipped", startedAt, { reason: "lead_blacklisted" });
  }

  // Working-hours gate: company-wide, cheap, before any agent query.
  if (settings?.workingHoursStart != null && settings?.workingHoursEnd != null) {
    if (!withinWorkingHours(nowMinuteOfDay(), settings.workingHoursStart, settings.workingHoursEnd)) {
      logger.info("assignment_skipped", { reason: "outside_working_hours" });
      return result("no_eligible_agent", startedAt, { reason: "outside_working_hours" });
    }
  }

  // STEP 3: Load available agents (availability service) + eligibility
  // filters, in the exact original order: active -> exclude -> presence ->
  // skill -> workload cap.
  let pool = await agentAvailability.loadActiveAgents(companyId);
  if (pool.length === 0) {
    logger.info("assignment_skipped", { reason: "no_active_agents" });
    return result("no_eligible_agent", startedAt, { reason: "no_active_agents" });
  }

  // Phase 17: a Progressive Release cycle restricts candidates to the agents
  // holding batch allowance. A HARD filter (no fallback to the full pool —
  // that would defeat the per-agent batch caps); every later gate still runs.
  if (request.allowedAgentIds) {
    const allowed = new Set(request.allowedAgentIds);
    pool = pool.filter((a) => allowed.has(a.id));
    if (pool.length === 0) {
      logger.info("assignment_skipped", { reason: "no_allowed_agents_in_pool" });
      return result("no_eligible_agent", startedAt, { reason: "no_allowed_agents_in_pool" });
    }
  }

  if (excludeAgentId) {
    const without = pool.filter((a) => a.id !== excludeAgentId);
    if (without.length > 0) pool = without;
  }

  const hbTimeout = settings?.heartbeatTimeoutSeconds ?? 90;
  const { assignable, presenceInUse, filteredOffline } = agentAvailability.filterAssignable(pool, hbTimeout);
  if (presenceInUse) {
    if (filteredOffline > 0) {
      metrics.increment("assignment.filtered_offline", filteredOffline);
      logger.debug("assignment_filtered", { reason: "offline_or_stale_heartbeat", filteredOffline, remaining: assignable.length });
    }
    if (assignable.length === 0) {
      metrics.increment("assignment.unassigned_no_agents");
      logger.info("assignment_skipped", { reason: "no_online_agents" });
      return result("no_eligible_agent", startedAt, { reason: "no_online_agents" });
    }
    pool = assignable;
  }

  const mode = settings?.assignmentMode || "weighted";

  // Skill filter (skill_based only) — never strands a lead: falls back to the
  // full pool if nobody has the skill.
  if (mode === "skill_based" && requiredSkillId) {
    const skilledRows = await db.select({ userId: userSkills.userId }).from(userSkills).where(eq(userSkills.skillId, requiredSkillId));
    const skilled = new Set(skilledRows.map((r) => r.userId));
    const eligible = pool.filter((a) => skilled.has(a.id));
    if (eligible.length > 0) pool = eligible;
    else logger.debug("assignment_overflow", { reason: "no_agent_with_required_skill", requiredSkillId });
  }

  // Workload map — computed once, reused by the cap filter and by the
  // least_active / ai strategies.
  const needsWorkload =
    (settings?.maxOpenLeadsPerAgent != null && leadRow?.priority !== "high") || mode === "least_active" || mode === "ai";
  let workloadByAgent = new Map<string, number>();
  if (needsWorkload) {
    const candidateIds = pool.map((a) => a.id);
    const workloadRows = await db
      .select({ ownerId: leads.ownerId, openCount: count() })
      .from(leads)
      .where(
        and(
          eq(leads.companyId, companyId),
          inArray(leads.ownerId, candidateIds),
          isNull(leads.deletedAt),
          notInArray(leads.disposition, TERMINAL_DISPOSITIONS)
        )
      )
      .groupBy(leads.ownerId);
    workloadByAgent = new Map(workloadRows.map((r) => [r.ownerId as string, r.openCount]));
  }

  // Workload cap — soft filter; "high" priority bypasses it; overflow if
  // every candidate is over cap.
  if (settings?.maxOpenLeadsPerAgent != null && leadRow?.priority !== "high") {
    const cap = settings.maxOpenLeadsPerAgent;
    const underCap = pool.filter((a) => (workloadByAgent.get(a.id) || 0) < cap);
    if (underCap.length > 0) {
      const filteredOut = pool.length - underCap.length;
      if (filteredOut > 0) {
        metrics.increment("assignment.filtered_workload", filteredOut);
        logger.debug("assignment_filtered", { reason: "workload_cap", filteredOut, remaining: underCap.length });
      }
      pool = underCap;
    } else {
      metrics.increment("assignment.overflow_used");
      logger.info("assignment_overflow", { reason: "all_candidates_over_workload_cap", cap });
    }
  }

  const rules = await loadRules(companyId);
  const weightByTier: Record<string, number> = { "1": 3, "2": 2, "3": 1 };
  for (const r of rules) weightByTier[r.tier] = r.weight;

  const isHigh = leadRow?.priority === "high";
  const candidateIds = pool.map((a) => a.id);

  // STEP 4: Select strategy.
  const strategy = resolveStrategy(mode);

  // Phase 3: for AI mode, warm the per-company AI caches (config + agent
  // features) BEFORE taking the lock, so scoring inside the lock does zero DB
  // work. Best-effort — a warm failure just means the strategy's own (cached)
  // fetch runs, and the AI strategy falls back safely regardless.
  if (mode === "ai" && pool.length > 1) {
    try {
      await warmAIContext(companyId, candidateIds, workloadByAgent);
    } catch {
      /* AI strategy handles its own fallback */
    }
  }

  // STEP 5 + 6: Choose candidate + atomically claim, inside the per-company
  // lock. The cursor advance, the strategy's decision, and the conditional
  // claim are all serialized per company; the claim itself (WHERE owner_id
  // IS NULL) makes double-assignment impossible even across instances.
  const claim = await lock.withLock(`assign:${companyId}`, async () => {
    const advanceCursor = async (): Promise<number> => {
      const rows = await db
        .update(automationSettings)
        .set({ assignmentCursor: sql`${automationSettings.assignmentCursor} + 1` })
        .where(eq(automationSettings.companyId, companyId))
        .returning({ assignmentCursor: automationSettings.assignmentCursor });
      return rows[0]?.assignmentCursor ?? 1;
    };

    const decision = await strategy.select({
      mode,
      candidates: pool,
      isHighPriority: isHigh,
      weightByTier,
      workloadByAgent,
      advanceCursor,
      companyId,
      leadId,
      // Phase 5: the lead's skill requirements (jsonb, falling back to the
      // legacy single requiredSkillId) — used by the AI strategy's skill factor.
      leadSkillRequirements: parseLeadRequirements({
        skillRequirements: leadRow?.skillRequirements ?? null,
        requiredSkillId: leadRow?.requiredSkillId ?? null,
      }),
    });
    if (!decision.agentId) return { kind: "no_agent" as const };

    const claimed = await db
      .update(leads)
      // Phase 4: advance the lifecycle to "assigned" + stamp assignedAt in the
      // SAME atomic claim — no extra write in the lock. The event is recorded
      // (through the lifecycle service) after the lock releases.
      .set({ ownerId: decision.agentId, lifecycleStage: "assigned", assignedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(leads.id, leadId), isNull(leads.ownerId)))
      .returning({ id: leads.id });
    if (claimed.length === 0) return { kind: "claim_lost" as const };

    await db.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, decision.agentId));
    return { kind: "assigned" as const, agentId: decision.agentId, rationale: decision.rationale, score: decision.score, detail: decision.detail };
  });

  if (claim.kind === "no_agent") {
    metrics.increment("assignment.unassigned_no_agents");
    logger.info("assignment_skipped", { reason: "no_eligible_agent_in_pool" });
    return result("no_eligible_agent", startedAt, { strategy: mode, candidateIds, reason: "no_eligible_agent_in_pool" });
  }
  if (claim.kind === "claim_lost") {
    metrics.increment("assignment.claim_lost");
    logger.info("assignment_claim_lost", { reason: "already_assigned_concurrently" });
    return result("claim_lost", startedAt, { strategy: mode, candidateIds, reason: "claim_lost:already_assigned_concurrently" });
  }

  const chosen = pool.find((a) => a.id === claim.agentId);
  metrics.increment("assignment.assigned");
  logger.info("assignment_decided", { chosenAgentId: claim.agentId, mode, poolSize: pool.length, source, score: claim.score });
  // Phase 4: record the lifecycle transition to "assigned" (stage + assignedAt
  // were already written atomically in the claim above). `from` is the stage
  // the lead was in before this assignment (new / queued).
  await recordStageEvent({
    leadId,
    companyId,
    from: (leadRow?.lifecycleStage as LifecycleStage) ?? null,
    toStage: "assigned",
    reason: `assigned:${mode}`,
    metadata: { agentId: claim.agentId, source },
  });
  return result("assigned", startedAt, {
    agentId: claim.agentId,
    strategy: mode,
    candidateIds,
    presenceStatus: chosen?.presenceStatus ?? null,
    reason: `${mode}:pool=${pool.length}:source=${source}:${claim.rationale}`,
    finalScore: claim.score ?? null,
    decisionDetail: claim.detail ?? null,
  });
}

// Full pipeline: STEP 7 (emit events) + STEP 8 (finish: persist history +
// metrics) wrap the pure decision. Lifecycle events run AFTER the lock is
// long released (decide() already returned), so slow listeners never extend
// how long concurrent same-company assignments wait.
export async function runPipeline(request: AssignmentRequest): Promise<AssignmentResult> {
  const startedAt = Date.now();
  const source: AssignSource = request.source ?? "arrival";
  const attempt = request.attempt ?? 1;
  const { leadId, companyId } = request;
  const logger = createLogger({ component: "assignment-engine", leadId, companyId });

  await assignmentEvents.started(leadId, companyId, source);

  let decision: AssignmentResult;
  try {
    decision = await decide(request, source, startedAt, logger);
  } catch (err) {
    logger.error("assignment_pipeline_error", { error: err instanceof Error ? err.message : String(err) });
    decision = result("error", startedAt, { reason: err instanceof Error ? err.message : "pipeline_error" });
  }

  // STEP 8: persist the decision (history + backward-compatible log).
  await recordDecision({ leadId, companyId, source, attempt, result: decision });

  // Phase 10 observability: assignment decision latency (p50/p95/max).
  metrics.recordTiming("assignment.decision_ms", decision.processingTimeMs);

  // STEP 7: lifecycle events + outcome metrics.
  const isRetryContext = source === "sweep" || source === "queue" || source === "recycle";
  if (decision.outcome === "assigned" && decision.agentId) {
    const strategy = decision.strategy ?? "unknown";
    await assignmentEvents.candidateSelected(leadId, companyId, decision.agentId, strategy);
    await assignmentEvents.completed(leadId, companyId, decision.agentId, strategy, decision.processingTimeMs);
    // MUST stay: existing notification + AI listeners are registered on this.
    await eventBus.emit("lead.assigned", { leadId, companyId, agentId: decision.agentId });
  } else if ((decision.outcome === "no_eligible_agent" || decision.outcome === "error") && !isRetryContext) {
    // Only surface a failure signal at arrival/manual — retries account their
    // own attempts/dead-letters via the durable queue's job metrics.
    metrics.increment("assignment.failed");
    await assignmentEvents.failed(leadId, companyId, decision.reason, attempt);
  }

  return decision;
}
