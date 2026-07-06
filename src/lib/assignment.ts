import { db } from "@/db";
import { assignmentLog, assignmentRules, automationSettings, leads, users, userSkills } from "@/db/schema";
import { and, count, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { cache } from "./infra/cache";
import { lock } from "./infra/lock";
import { queue } from "./infra/queue";
import { eventBus } from "./events/bus";
import { isAgentAvailable } from "./presence";
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

/**
 * Tiered assignment engine supporting three modes (see automation_settings.assignmentMode):
 *
 * - "round_robin": every active agent gets an equal share, in order.
 * - "weighted" (default): weighted round-robin by tier (Tier 1 = 3, Tier 2 = 2,
 *   Tier 3 = 1 by default, configurable). Higher tier = proportionally more leads.
 * - "skill_based": if the lead has a requiredSkillId, only agents with that
 *   skill are eligible; among those, still weighted by tier. Falls back to
 *   the full active-agent pool if no agent has the required skill, so a
 *   lead never goes unassigned just because of a skill mismatch.
 *
 * On top of the mode, every assignment now also requires (see the
 * corresponding filter step below): the lead isn't blacklisted, the agent
 * isn't locked by a supervisor, the agent is online (once presence
 * tracking is actually in use for this company — see the bootstrapping
 * note), the company is within its configured working hours (if any), and
 * the agent is under its configured workload cap (if any, and unless the
 * lead is "high" priority, which bypasses the cap) — with overflow
 * (relaxing the workload cap) if enforcing it would leave nobody eligible.
 *
 * Every assignment is logged in assignment_log for a full audit trail. This
 * runs synchronously per lead, which is comfortably fast for the
 * thousands-of-leads/day, 20-100-agent scale this was built for. If ingestion
 * volume grows far beyond that, this function can be dropped unchanged into
 * a queue worker (e.g. BullMQ + Redis).
 */
export async function assignLead(leadId: string, companyId: string, requiredSkillId?: string | null, excludeAgentId?: string | null) {
  const logger = createLogger({ component: "assignment", leadId, companyId });

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
  // Fetched once here since priority is also needed below for the
  // workload-cap bypass.
  const [leadRow] = await db.select({ priority: leads.priority, isBlacklisted: leads.isBlacklisted }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (leadRow?.isBlacklisted) {
    metrics.increment("assignment.skipped_blacklisted");
    logger.info("assignment_skipped", { reason: "lead_blacklisted" });
    return null;
  }

  // Working-hours gate: company-wide (not per-agent — a single configured
  // window is most of the value for far less complexity than per-agent
  // shift scheduling, which is its own product area). A cheap check, done
  // before any agent query, since if it fails nothing else matters.
  const workingHoursStart = settings?.workingHoursStart;
  const workingHoursEnd = settings?.workingHoursEnd;
  if (workingHoursStart != null && workingHoursEnd != null) {
    const nowMinute = getCurrentMinuteOfDay();
    if (!isWithinWorkingHours(nowMinute, workingHoursStart, workingHoursEnd)) {
      logger.info("assignment_skipped", { reason: "outside_working_hours", nowMinute, workingHoursStart, workingHoursEnd });
      return null;
    }
  }

  let activeAgents = await db
    .select({ id: users.id, tier: users.tier, presenceStatus: users.presenceStatus, lastHeartbeatAt: users.lastHeartbeatAt })
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
    return null; // leaves lead unassigned
  }

  if (excludeAgentId) {
    const withoutExcluded = activeAgents.filter((a) => a.id !== excludeAgentId);
    if (withoutExcluded.length > 0) activeAgents = withoutExcluded;
  }

  // Presence filter — deliberately opt-in: only enforced once at least one
  // agent at this company has ever sent a heartbeat. Every agent row
  // defaults to presenceStatus="offline" (including every agent that
  // existed before this feature shipped), so enforcing this unconditionally
  // from day one would make every company's assignment silently stop
  // working the moment this deploys, until each agent's browser tab
  // reloads and starts heartbeating. Falling back to "don't filter" until
  // presence data actually exists for this company avoids that outage
  // while still making the filter fully real the moment it's in use.
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
      return null;
    }
    activeAgents = onlineAgents;
  }

  const mode = settings?.assignmentMode || "weighted";

  if (mode === "skill_based" && requiredSkillId) {
    const skilledAgentRows = await db
      .select({ userId: userSkills.userId })
      .from(userSkills)
      .where(eq(userSkills.skillId, requiredSkillId));
    const skilledIds = new Set(skilledAgentRows.map((r) => r.userId));
    const eligible = activeAgents.filter((a) => skilledIds.has(a.id));
    // Fall back to the full pool if nobody has the skill — never leave a lead stranded.
    if (eligible.length > 0) {
      activeAgents = eligible;
    } else {
      logger.debug("assignment_overflow", { reason: "no_agent_with_required_skill", requiredSkillId });
    }
  }

  // Workload cap — a soft filter: skip agents at/above the configured cap
  // in favor of a less-loaded one, but if EVERY remaining candidate is
  // over the cap, overflow (assign anyway) rather than leave the lead
  // unassigned — by this point every candidate is already known to be
  // online, in-hours, and skill-matched, so slightly overloading one of
  // them is strictly better than no assignment at all.
  // A "high" priority lead (VIP routing) skips this filter entirely rather
  // than waiting for a less-loaded agent — presence/hours/skill filters
  // still apply, only the workload cap is bypassed.
  if (settings?.maxOpenLeadsPerAgent != null && leadRow?.priority !== "high") {
    const cap = settings.maxOpenLeadsPerAgent;
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
    const workloadByAgent = new Map(workloadRows.map((r) => [r.ownerId, r.openCount]));

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

  const sortedAgents = [...activeAgents].sort((a, b) => (a.tier || "1").localeCompare(b.tier || "1"));
  const cycle: string[] = [];
  for (const agent of sortedAgents) {
    const weight = mode === "round_robin" ? 1 : weightByTier[agent.tier || "1"] ?? 1;
    for (let i = 0; i < weight; i++) cycle.push(agent.id);
  }
  if (cycle.length === 0) return null;

  // Everything from here on must be atomic per company: advancing the
  // cursor, deciding the next agent in the cycle, and recording that
  // decision. Without this lock, two concurrent assignments for the same
  // company could each advance the cursor but then race on which one's
  // `cycle[cursor]` lookup and lead/assignment_log writes land last,
  // breaking the round-robin guarantee. In-process only (see
  // src/lib/infra/lock.ts) — sufficient for the current single-instance
  // deployment, not yet for multiple instances.
  const chosenAgentId = await lock.withLock(`assign:${companyId}`, async () => {
    // O(1) regardless of assignment history: an atomic increment on a
    // persistent counter (see automationSettings.assignmentCursor) instead
    // of counting every historical assignment_log row for this company on
    // every call. UPDATE ... RETURNING is a single statement, so the
    // read-modify-write is atomic at the database level even without the
    // lock — the lock above is still what protects the cycle/leads/
    // assignment_log writes from interleaving with a concurrent assignment
    // for the same company.
    const cursorRows = await db
      .update(automationSettings)
      .set({ assignmentCursor: sql`${automationSettings.assignmentCursor} + 1` })
      .where(eq(automationSettings.companyId, companyId))
      .returning({ assignmentCursor: automationSettings.assignmentCursor });
    // Falls back to 1 (-> cursor 0) if a company somehow has no
    // automation_settings row yet — shouldn't happen (every company gets
    // one in the signup transaction), but this is the boundary of the
    // system, so degrade gracefully to "start of the cycle" instead of
    // throwing on a destructure of an empty result.
    const nextCursor = cursorRows[0]?.assignmentCursor ?? 1;

    const cursor = (nextCursor - 1) % cycle.length;
    const chosenAgentId = cycle[cursor];

    await db.update(leads).set({ ownerId: chosenAgentId, updatedAt: new Date() }).where(eq(leads.id, leadId));
    await db.insert(assignmentLog).values({
      leadId,
      assignedTo: chosenAgentId,
      ruleUsed: `${mode}:cursor=${cursor}`,
    });

    return chosenAgentId;
  });

  logger.info("assignment_decided", { chosenAgentId, mode, poolSize: cycle.length });

  // Emitted AFTER the lock releases, deliberately: the notification and AI
  // automation listeners (Phase 5/6) do several more DB queries each, and
  // running that work while still holding the per-company assignment lock
  // would extend how long concurrent assignments for the same company have
  // to wait, for no correctness benefit — the event payload is already
  // fully determined by the time the lock resolves. emit() catches its own
  // listener errors (see event bus), so a slow/failing listener here still
  // can't turn a successful assignment into a failed one.
  await eventBus.emit("lead.assigned", { leadId, companyId, agentId: chosenAgentId });

  return chosenAgentId;
}

// Registers this module's job handler with the in-process queue (see
// src/lib/infra/queue.ts) as a side effect of importing this file — so any
// route that wants to go through `queue.enqueue("lead.assign", ...)`
// instead of calling assignLead() directly just needs
// `import "@/lib/assignment"` to guarantee the handler exists before it's
// used, regardless of which route happens to run first.
queue.register("lead.assign", async (payload) => {
  await assignLead(payload.leadId, payload.companyId, payload.requiredSkillId, payload.excludeAgentId);
});
