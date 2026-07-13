import { db } from "@/db";
import { assignmentLog, assignmentRules, automationSettings, leads, users, userSkills } from "@/db/schema";
import { and, count, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { cache } from "./infra/cache";
import { lock } from "./infra/lock";
import { queue } from "./infra/queue";
import { eventBus } from "./events/bus";
import { isAgentAvailable, ELIGIBLE_PRESENCE_STATUSES, type PresenceStatus } from "./presence";
import { WON_DISPOSITION } from "./analytics/kpis";
import { createLogger } from "./logger";
import { metrics } from "./infra/metrics";
import "./notifications/listeners"; // registers the lead.assigned -> in-app notification listener
import "./ai/automation"; // registers the lead.assigned -> AI recommendation listener

// Dispositions that mean "this lead is done" — used both for workload
// counting below (an agent's open workload shouldn't include leads they've
// already closed out) and by the recycle cron (a closed-out lead should
// never be auto-recycled). Exported so both stay in sync with exactly one
// definition of "closed." Reuses the same WON_DISPOSITION constant the
// analytics/KPI layer already uses.
export const TERMINAL_DISPOSITIONS = [WON_DISPOSITION, "Not Interested"];

// Where an assignment attempt originated. Controls one thing: whether a
// failed attempt (no eligible agent) writes a "failed" assignment_log row.
// Only the lead's ARRIVAL logs that once; the queue sweep retries the same
// unassigned leads repeatedly and must NOT write a failed row every pass,
// which would flood the table (retry-storm protection for the log itself).
export type AssignSource = "arrival" | "sweep" | "manual";
export interface AssignOptions {
  source?: AssignSource;
}

type CandidateAgent = {
  id: string;
  tier: string | null;
  presenceStatus: PresenceStatus;
  lastHeartbeatAt: Date | null;
  lastAssignedAt: Date | null;
};

function getCurrentMinuteOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// Supports overnight windows (e.g. 10pm-6am, start > end) by wrapping
// around midnight, not just the simple 9am-6pm case.
function isWithinWorkingHours(nowMinute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute <= endMinute) return nowMinute >= startMinute && nowMinute < endMinute;
  return nowMinute >= startMinute || nowMinute < endMinute;
}

// Records the outcome of an assignment attempt — one row per attempt, with
// the full "who/why/how/how-long/what-presence" trail the spec asks for.
async function logAssignment(row: {
  leadId: string;
  assignedTo: string | null;
  status: "assigned" | "failed" | "skipped";
  mode: string;
  presenceStatus?: string | null;
  latencyMs: number;
  reason: string;
}) {
  await db.insert(assignmentLog).values({
    leadId: row.leadId,
    assignedTo: row.assignedTo,
    status: row.status,
    ruleUsed: row.mode,
    presenceStatus: row.presenceStatus ?? null,
    latencyMs: row.latencyMs,
    reason: row.reason,
  });
}

/**
 * The lead assignment engine. Runs on every lead from every source (Meta
 * webhook, historical import, website form, API) with zero manager
 * involvement — a lead that can't be placed right now stays ownerId=NULL
 * and is retried by the queue sweep (see assignment-queue.ts) the moment an
 * agent becomes available, so the platform distributes leads perfectly even
 * if no manager ever logs in.
 *
 * Selection modes (automation_settings.assignmentMode), all applied AFTER
 * the eligibility filters (blacklist, working hours, presence, skill,
 * workload cap):
 *   - round_robin     : equal rotation, cursor-based.
 *   - weighted        : rotation weighted by tier (Tier 1=3, 2=2, 3=1, configurable).
 *   - tier_based      : always the highest tier with an available agent; rotate within it.
 *   - priority_based  : "high" leads -> highest tier; everyone else -> weighted.
 *   - skill_based     : restrict to agents with the lead's required skill, then weighted.
 *   - last_assigned   : sticky — the agent who got the previous lead keeps getting them
 *                       while eligible (burst affinity); falls back to round-robin.
 *   - least_active    : the agent with the fewest open (non-terminal) leads.
 *   - most_available  : the agent idle longest (oldest lastAssignedAt = been waiting most).
 *   - random          : a uniformly random eligible agent.
 *   - ai              : adaptive composite score (idle time + inverse workload + tier).
 *
 * Concurrency: the per-company in-process lock serializes the cursor
 * read-modify-write, and the final claim is a conditional
 * `UPDATE ... WHERE owner_id IS NULL` — so even two callers that both pick
 * an agent (e.g. the arrival path and a queue sweep racing on the same
 * lead, or a second app instance) can never double-assign; the loser gets
 * an empty RETURNING and records a "skipped" row instead.
 */
export async function assignLead(
  leadId: string,
  companyId: string,
  requiredSkillId?: string | null,
  excludeAgentId?: string | null,
  options?: AssignOptions
): Promise<string | null> {
  const source: AssignSource = options?.source ?? "arrival";
  const startedAt = Date.now();
  const logger = createLogger({ component: "assignment", leadId, companyId });

  // Failed attempts are logged once, at arrival, never by sweep retries.
  const recordFailure = async (reason: string) => {
    if (source === "arrival") {
      await logAssignment({ leadId, assignedTo: null, status: "failed", mode: "n/a", latencyMs: Date.now() - startedAt, reason });
    }
  };

  // automation_settings and assignment_rules are read on every single
  // assignment (i.e. on every lead creation, every CSV row, every webhook
  // lead) but only change when an admin edits them in Settings — a classic
  // cache-aside candidate. 30s TTL bounds staleness; the settings/rules
  // PATCH routes also explicitly invalidate these keys on write, so the
  // common case (change a setting, then create a lead) is correct
  // immediately rather than waiting out the TTL.
  const settings = await cache.getOrSet(`automation-settings:${companyId}`, 30_000, async () => {
    const [row] = await db.select().from(automationSettings).where(eq(automationSettings.companyId, companyId)).limit(1);
    return row ?? null;
  });

  if (settings && !settings.autoAssignEnabled) {
    logger.debug("assignment_skipped", { reason: "auto_assign_disabled" });
    return null; // auto-assignment toggled off for this company
  }

  // Blacklisted leads (DNC requests, etc.) are never auto-assigned — a
  // supervisor can still assign one manually via the Team dashboard.
  const [leadRow] = await db
    .select({ priority: leads.priority, isBlacklisted: leads.isBlacklisted })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (leadRow?.isBlacklisted) {
    metrics.increment("assignment.skipped_blacklisted");
    logger.info("assignment_skipped", { reason: "lead_blacklisted" });
    return null;
  }

  // Working-hours gate: company-wide, cheap, done before any agent query.
  const workingHoursStart = settings?.workingHoursStart;
  const workingHoursEnd = settings?.workingHoursEnd;
  if (workingHoursStart != null && workingHoursEnd != null) {
    const nowMinute = getCurrentMinuteOfDay();
    if (!isWithinWorkingHours(nowMinute, workingHoursStart, workingHoursEnd)) {
      logger.info("assignment_skipped", { reason: "outside_working_hours", nowMinute, workingHoursStart, workingHoursEnd });
      await recordFailure("outside_working_hours");
      return null;
    }
  }

  let activeAgents: CandidateAgent[] = await db
    .select({
      id: users.id,
      tier: users.tier,
      presenceStatus: users.presenceStatus,
      lastHeartbeatAt: users.lastHeartbeatAt,
      lastAssignedAt: users.lastAssignedAt,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.role, "agent"),
        eq(users.active, true),
        eq(users.locked, false),
        isNull(users.deletedAt)
      )
    );

  if (activeAgents.length === 0) {
    logger.info("assignment_skipped", { reason: "no_active_agents" });
    await recordFailure("no_active_agents");
    return null; // leaves lead unassigned
  }

  if (excludeAgentId) {
    const withoutExcluded = activeAgents.filter((a) => a.id !== excludeAgentId);
    if (withoutExcluded.length > 0) activeAgents = withoutExcluded;
  }

  // Presence filter — deliberately opt-in: only enforced once at least one
  // agent at this company has ever sent a heartbeat, so companies whose
  // agents haven't started heartbeating yet don't have assignment silently
  // stop. See ELIGIBLE_PRESENCE_STATUSES / isAgentAvailable in presence.ts
  // for the exact spec-defined eligibility (ignores offline/locked/break/
  // lunch/away + stale-heartbeat).
  const presenceInUse = activeAgents.some((a) => a.lastHeartbeatAt !== null);
  if (presenceInUse) {
    const heartbeatTimeoutSeconds = settings?.heartbeatTimeoutSeconds ?? 90;
    const onlineAgents = activeAgents.filter((a) => isAgentAvailable(a, heartbeatTimeoutSeconds));
    const filteredOut = activeAgents.length - onlineAgents.length;
    if (filteredOut > 0) {
      metrics.increment("assignment.filtered_offline", filteredOut);
      logger.debug("assignment_filtered", { reason: "offline_or_stale_heartbeat", filteredOut, remaining: onlineAgents.length });
    }
    if (onlineAgents.length === 0) {
      metrics.increment("assignment.unassigned_no_agents");
      logger.info("assignment_skipped", { reason: "no_online_agents" });
      await recordFailure("no_online_agents");
      return null;
    }
    activeAgents = onlineAgents;
  }

  const mode = settings?.assignmentMode || "weighted";

  // Skill filter — applies to skill_based only (an explicit mode) but never
  // strands a lead: falls back to the full pool if nobody has the skill.
  if (mode === "skill_based" && requiredSkillId) {
    const skilledAgentRows = await db
      .select({ userId: userSkills.userId })
      .from(userSkills)
      .where(eq(userSkills.skillId, requiredSkillId));
    const skilledIds = new Set(skilledAgentRows.map((r) => r.userId));
    const eligible = activeAgents.filter((a) => skilledIds.has(a.id));
    if (eligible.length > 0) {
      activeAgents = eligible;
    } else {
      logger.debug("assignment_overflow", { reason: "no_agent_with_required_skill", requiredSkillId });
    }
  }

  // Workload map — needed both for the (optional) workload-cap filter and
  // for the least_active / ai selection modes. Computed once, reused.
  const needsWorkload =
    (settings?.maxOpenLeadsPerAgent != null && leadRow?.priority !== "high") || mode === "least_active" || mode === "ai";
  let workloadByAgent = new Map<string, number>();
  if (needsWorkload) {
    const candidateIds = activeAgents.map((a) => a.id);
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

  // Workload cap — soft filter, "high" priority bypasses it, overflow if
  // every candidate is over cap (better to slightly overload than to leave
  // an online agent's lead unassigned).
  if (settings?.maxOpenLeadsPerAgent != null && leadRow?.priority !== "high") {
    const cap = settings.maxOpenLeadsPerAgent;
    const underCap = activeAgents.filter((a) => (workloadByAgent.get(a.id) || 0) < cap);
    if (underCap.length > 0) {
      const filteredOut = activeAgents.length - underCap.length;
      if (filteredOut > 0) {
        metrics.increment("assignment.filtered_workload", filteredOut);
        logger.debug("assignment_filtered", { reason: "workload_cap", filteredOut, remaining: underCap.length });
      }
      activeAgents = underCap;
    } else {
      metrics.increment("assignment.overflow_used");
      logger.info("assignment_overflow", { reason: "all_candidates_over_workload_cap", cap });
    }
  }

  const rules = await cache.getOrSet(`assignment-rules:${companyId}`, 30_000, async () =>
    db.select().from(assignmentRules).where(and(eq(assignmentRules.companyId, companyId), eq(assignmentRules.active, true)))
  );
  const weightByTier: Record<string, number> = { "1": 3, "2": 2, "3": 1 };
  for (const r of rules) weightByTier[r.tier] = r.weight;

  const isHigh = leadRow?.priority === "high";

  // Everything from here on is atomic per company: the cursor advance, the
  // agent decision, and the conditional claim. See the class comment on the
  // conditional UPDATE for why this is race-free even across instances.
  const result = await lock.withLock(`assign:${companyId}`, async () => {
    // Cursor advance is O(1) and atomic on its own (UPDATE ... RETURNING),
    // used by every rotation-based mode. Fetched inside the lock so the
    // value is stable across the decision below.
    const advanceCursor = async (): Promise<number> => {
      const cursorRows = await db
        .update(automationSettings)
        .set({ assignmentCursor: sql`${automationSettings.assignmentCursor} + 1` })
        .where(eq(automationSettings.companyId, companyId))
        .returning({ assignmentCursor: automationSettings.assignmentCursor });
      return cursorRows[0]?.assignmentCursor ?? 1;
    };

    const chosenAgentId = await chooseAgent({
      mode,
      agents: activeAgents,
      isHigh,
      weightByTier,
      workloadByAgent,
      advanceCursor,
    });
    if (!chosenAgentId) return null;

    // Atomic claim: only assigns if the lead is still unclaimed. A
    // concurrent winner (other instance, or the sweep vs arrival race)
    // makes this a no-op and we back off without double-assigning.
    const claimed = await db
      .update(leads)
      .set({ ownerId: chosenAgentId, updatedAt: new Date() })
      .where(and(eq(leads.id, leadId), isNull(leads.ownerId)))
      .returning({ id: leads.id });

    if (claimed.length === 0) {
      return { claimLost: true as const };
    }

    await db.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, chosenAgentId));
    return { chosenAgentId };
  });

  if (!result) {
    metrics.increment("assignment.unassigned_no_agents");
    logger.info("assignment_skipped", { reason: "no_eligible_agent_in_pool" });
    await recordFailure("no_eligible_agent_in_pool");
    return null;
  }
  if ("claimLost" in result) {
    metrics.increment("assignment.claim_lost");
    logger.info("assignment_claim_lost", { reason: "already_assigned_concurrently" });
    await logAssignment({
      leadId,
      assignedTo: null,
      status: "skipped",
      mode,
      latencyMs: Date.now() - startedAt,
      reason: "claim_lost:already_assigned_concurrently",
    });
    return null;
  }

  const chosenAgentId = result.chosenAgentId;
  const chosenAgent = activeAgents.find((a) => a.id === chosenAgentId);
  const latencyMs = Date.now() - startedAt;

  await logAssignment({
    leadId,
    assignedTo: chosenAgentId,
    status: "assigned",
    mode,
    presenceStatus: chosenAgent?.presenceStatus ?? null,
    latencyMs,
    reason: `${mode}:pool=${activeAgents.length}:source=${source}`,
  });
  metrics.increment("assignment.assigned");
  logger.info("assignment_decided", { chosenAgentId, mode, poolSize: activeAgents.length, latencyMs, source });

  // Emitted AFTER the lock releases: the notification + AI listeners do more
  // DB work each, and running that while holding the per-company assignment
  // lock would extend how long concurrent assignments for the same company
  // wait, for no correctness benefit. emit() catches listener errors, so a
  // slow/failing listener can't turn a successful assignment into a failure.
  await eventBus.emit("lead.assigned", { leadId, companyId, agentId: chosenAgentId });

  return chosenAgentId;
}

// Pure-ish selection: given the already-filtered eligible pool + mode,
// returns the chosen agent id (or null if the pool is empty). Rotation
// modes call advanceCursor() to stay fair across calls; direct modes
// compute from agent data. Kept a single function so every mode is visible
// in one place and shares the same tie-break discipline.
async function chooseAgent(ctx: {
  mode: string;
  agents: CandidateAgent[];
  isHigh: boolean;
  weightByTier: Record<string, number>;
  workloadByAgent: Map<string, number>;
  advanceCursor: () => Promise<number>;
}): Promise<string | null> {
  const { mode, agents, isHigh, weightByTier, workloadByAgent, advanceCursor } = ctx;
  if (agents.length === 0) return null;
  if (agents.length === 1) return agents[0].id;

  const tierOf = (a: CandidateAgent) => a.tier || "1";
  const idleMs = (a: CandidateAgent) => (a.lastAssignedAt ? Date.now() - a.lastAssignedAt.getTime() : Number.MAX_SAFE_INTEGER);

  // Build a rotation cycle (with per-tier weight repetition) and pick the
  // cursor'th slot — shared by round_robin / weighted / skill_based.
  const rotateWeighted = async (weightFn: (a: CandidateAgent) => number): Promise<string> => {
    const sorted = [...agents].sort((a, b) => tierOf(a).localeCompare(tierOf(b)) || a.id.localeCompare(b.id));
    const cycle: string[] = [];
    for (const agent of sorted) {
      const w = Math.max(1, weightFn(agent));
      for (let i = 0; i < w; i++) cycle.push(agent.id);
    }
    const nextCursor = await advanceCursor();
    return cycle[(nextCursor - 1) % cycle.length];
  };

  switch (mode) {
    case "round_robin":
      return rotateWeighted(() => 1);

    case "weighted":
      return rotateWeighted((a) => weightByTier[tierOf(a)] ?? 1);

    case "skill_based":
      // Pool is already skill-filtered upstream; distribute by tier weight.
      return rotateWeighted((a) => weightByTier[tierOf(a)] ?? 1);

    case "tier_based": {
      // Only the best tier present gets leads; rotate equally within it.
      const bestTier = agents.map(tierOf).sort()[0];
      const top = agents.filter((a) => tierOf(a) === bestTier);
      const nextCursor = await advanceCursor();
      const sorted = [...top].sort((a, b) => a.id.localeCompare(b.id));
      return sorted[(nextCursor - 1) % sorted.length].id;
    }

    case "priority_based": {
      // High-priority leads go to the best available tier; normal leads use
      // the standard weighted rotation.
      if (isHigh) {
        const bestTier = agents.map(tierOf).sort()[0];
        const top = agents.filter((a) => tierOf(a) === bestTier);
        const nextCursor = await advanceCursor();
        const sorted = [...top].sort((a, b) => a.id.localeCompare(b.id));
        return sorted[(nextCursor - 1) % sorted.length].id;
      }
      return rotateWeighted((a) => weightByTier[tierOf(a)] ?? 1);
    }

    case "last_assigned": {
      // Sticky: the agent assigned most recently keeps the affinity while
      // still eligible (keeps a burst with one rep). Falls through to
      // round-robin the first time (no prior assignment in the pool).
      const withPrior = agents.filter((a) => a.lastAssignedAt !== null);
      if (withPrior.length > 0) {
        return withPrior.sort((a, b) => (b.lastAssignedAt!.getTime() - a.lastAssignedAt!.getTime()))[0].id;
      }
      return rotateWeighted(() => 1);
    }

    case "least_active": {
      // Fewest open leads; ties broken by longest idle.
      return [...agents].sort(
        (a, b) => (workloadByAgent.get(a.id) || 0) - (workloadByAgent.get(b.id) || 0) || idleMs(b) - idleMs(a)
      )[0].id;
    }

    case "most_available": {
      // Idle longest (been waiting most for a lead); ties by id for determinism.
      return [...agents].sort((a, b) => idleMs(b) - idleMs(a) || a.id.localeCompare(b.id))[0].id;
    }

    case "random":
      return agents[Math.floor(Math.random() * agents.length)].id;

    case "ai": {
      // Adaptive composite: prefer long-idle + low-workload + higher tier.
      // Normalized 0..1 per signal so no single term dominates; this is the
      // seam a learned model replaces later without touching callers.
      const maxIdle = Math.max(...agents.map(idleMs), 1);
      const maxLoad = Math.max(...agents.map((a) => workloadByAgent.get(a.id) || 0), 1);
      const score = (a: CandidateAgent) => {
        const idleScore = idleMs(a) / maxIdle; // more idle = better
        const loadScore = 1 - (workloadByAgent.get(a.id) || 0) / maxLoad; // less loaded = better
        const tierScore = (weightByTier[tierOf(a)] ?? 1) / 3; // higher tier = better
        return idleScore * 0.5 + loadScore * 0.3 + tierScore * 0.2;
      };
      return [...agents].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0].id;
    }

    default:
      return rotateWeighted((a) => weightByTier[tierOf(a)] ?? 1);
  }
}

// Registers this module's job handler with the in-process queue (see
// src/lib/infra/queue.ts) as a side effect of importing this file — so any
// route that wants to go through `queue.enqueue("lead.assign", ...)`
// instead of calling assignLead() directly just needs `import
// "@/lib/assignment"` to guarantee the handler exists before it's used.
queue.register("lead.assign", async (payload) => {
  await assignLead(payload.leadId, payload.companyId, payload.requiredSkillId, payload.excludeAgentId);
});
