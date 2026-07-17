// Phase 17 — the Progressive Lead Release engine.
//
// Replaces the full-drain behavior of the owner-NULL sweep when a company
// enables it: instead of handing the entire overnight backlog to whoever is
// online first, the backlog is released in small per-agent batches (sized by
// tier), paced by a configurable interval, with a configurable share of the
// wave held in reserve until more of the team comes online.
//
// What this deliberately does NOT do:
//   • It does not touch fresh-arrival assignment. A lead that arrives while
//     agents are eligible is still assigned instantly by the existing engine
//     (speed-to-lead is sacred); only the QUEUED BACKLOG is paced.
//   • It does not pick agents itself. Each released lead goes through the
//     EXISTING assignment pipeline (strategy, AI scoring, gates, atomic claim,
//     history, lifecycle, events, notifications) — restricted to the agents
//     who still have batch allowance this cycle. Same rules, same audit trail,
//     same explainability; the release engine only decides HOW MANY and WHEN.
//
// Determinism (spec: "NO RANDOM ASSIGNMENT"): agents are ordered by
// lastAssignedAt (longest-waiting first), leads by the sweep's exact order
// (high priority first, then oldest). The reserve formula is a pure function
// of (initial backlog, released so far, % configured, share of the team
// online). A manager can always reconstruct why a lead moved.
import { db } from "@/db";
import { leads, progressiveReleaseState } from "@/db/schema";
import { and, asc, count, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/infra/metrics";
import { recordAudit } from "@/lib/audit";
import { TERMINAL_DISPOSITIONS } from "../constants";
import { agentAvailability } from "../availability";
import { assignmentEngine } from "../engine";
import { getAIConfig } from "../ai/config";
import { getAgentProfiles, isWithinSchedule, profileFor } from "../ai/agent-profile";
import { getProgressiveConfig, type ProgressiveReleaseConfig, type TierName } from "./config";
import { cache } from "@/lib/infra/cache";
import { automationSettings } from "@/db/schema";

const logger = createLogger({ component: "progressive-release" });

export interface CycleResult {
  ran: boolean; // false = pacing gate not due (or another instance ran it)
  assigned: number;
  attempted: number;
  backlog: number; // backlog remaining AFTER this cycle's releases
  target: number; // wave releasable target at this cycle's participation
  released: number; // total released this wave (including this cycle)
  eligibleAgents: number;
}

const NOT_RUN: CycleResult = { ran: false, assigned: 0, attempted: 0, backlog: 0, target: 0, released: 0, eligibleAgents: 0 };

// The sweep's exact backlog predicate — the release engine must count and
// fetch the same leads the old drain would have.
function backlogWhere(companyId: string) {
  return and(
    eq(leads.companyId, companyId),
    isNull(leads.ownerId),
    isNull(leads.deletedAt),
    eq(leads.isBlacklisted, false),
    notInArray(leads.disposition, TERMINAL_DISPOSITIONS)
  );
}

// The reserved-backlog formula. R is the reserved share (0..1); participation
// is eligible-online agents / all assignable agents. The releasable share of a
// wave grows linearly from (1−R) with nobody online toward 100% with the whole
// team online — early agents can never consume the reserve alone, and every
// agent who logs in unlocks more of it ("late agents receive future batches").
export function releasableTarget(initialBacklog: number, reservedPercent: number, participation: number): number {
  const r = Math.min(Math.max(reservedPercent, 0), 90) / 100;
  const p = Math.min(Math.max(participation, 0), 1);
  return Math.ceil(initialBacklog * (1 - r + r * p));
}

// Atomically claim the right to run this company's cycle. The state row's
// next_release_at is both the pacing gate and the cross-instance mutex: only
// the UPDATE that observes it due (or null) wins; everyone else no-ops. The
// interval is stamped BEFORE the cycle runs so a crash mid-cycle can never
// wedge the gate — the next interval simply opens it again.
async function claimCycle(companyId: string, intervalMinutes: number): Promise<{ initialBacklog: number; releasedCount: number; waveStartedAt: Date | null } | null> {
  await db.insert(progressiveReleaseState).values({ companyId }).onConflictDoNothing();
  const res = await db.execute(sql`
    UPDATE progressive_release_state
    SET next_release_at = now() + make_interval(mins => ${intervalMinutes}), last_cycle_at = now(), updated_at = now()
    WHERE company_id = ${companyId} AND (next_release_at IS NULL OR next_release_at <= now())
    RETURNING initial_backlog, released_count, wave_started_at
  `);
  const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  if (rows.length === 0) return null;
  // Raw execute() rows bypass drizzle's column mapping, so the timestamp can
  // arrive as a string. Normalize to Date HERE — this value is later written
  // back through the typed update (wave-growth path), which requires a Date.
  const ws = rows[0].wave_started_at;
  return {
    initialBacklog: Number(rows[0].initial_backlog),
    releasedCount: Number(rows[0].released_count),
    waveStartedAt: ws ? new Date(ws as string | Date) : null,
  };
}

// One release cycle for one company. Called from the same two triggers that
// drive the old sweep (heartbeat kick + cron backstop) — no new workers, no
// polling. Every cycle recomputes backlog / agents / capacity from live data;
// nothing about a previous cycle's decisions is cached or reused.
export async function runProgressiveCycle(companyId: string, cfgIn?: ProgressiveReleaseConfig): Promise<CycleResult> {
  const cfg = cfgIn ?? (await getProgressiveConfig(companyId));
  if (!cfg.enabled) return NOT_RUN;

  const state = await claimCycle(companyId, cfg.releaseIntervalMinutes);
  if (!state) return NOT_RUN; // not due yet, or another instance owns this tick

  const startedAt = Date.now();

  // Live backlog count (indexed: leads_company_owner_idx).
  const [{ n: backlogNow }] = await db.select({ n: count() }).from(leads).where(backlogWhere(companyId));
  if (backlogNow === 0) {
    // Wave over — reset the bookkeeping so the next backlog starts fresh.
    if (state.waveStartedAt !== null || state.releasedCount > 0) {
      await db
        .update(progressiveReleaseState)
        .set({ waveStartedAt: null, initialBacklog: 0, releasedCount: 0, updatedAt: new Date() })
        .where(eq(progressiveReleaseState.companyId, companyId));
    }
    return { ran: true, assigned: 0, attempted: 0, backlog: 0, target: 0, released: 0, eligibleAgents: 0 };
  }

  // ── Eligibility (recomputed every cycle, per spec) ────────────────────────
  // roster: active, unlocked, non-deleted agents of THIS company (tenant
  // isolation + "has assignment permission" — only role=agent is assignable).
  const roster = await agentAvailability.loadActiveAgents(companyId);
  const totalAssignable = roster.length;

  // online + available (presence-eligible: not offline/away/break/lunch/stale).
  const settings = await cache.getOrSet(`automation-settings:${companyId}`, 30_000, async () => {
    const [row] = await db.select().from(automationSettings).where(eq(automationSettings.companyId, companyId)).limit(1);
    return row ?? null;
  });
  const hbTimeout = settings?.heartbeatTimeoutSeconds ?? 90;
  const { assignable } = agentAvailability.filterAssignable(roster, hbTimeout);

  // not paused (AI config pause list) + inside their own working schedule.
  const aiCfg = await getAIConfig(companyId);
  const paused = new Set(aiCfg.pausedAgentIds);
  const profiles = await getAgentProfiles(companyId);
  const now = new Date();
  const eligible = assignable.filter((a) => !paused.has(a.id) && isWithinSchedule(profileFor(profiles, a.id).schedule, now));

  if (eligible.length === 0) {
    logger.debug("progressive_cycle_idle", { companyId, backlog: backlogNow, reason: "no_eligible_agents" });
    return { ran: true, assigned: 0, attempted: 0, backlog: backlogNow, target: 0, released: state.releasedCount, eligibleAgents: 0 };
  }

  // ── Capacity: current open-lead count per eligible agent (one indexed
  // grouped query — never per-agent queries, so cycle cost is O(eligible)).
  const eligibleIds = eligible.map((a) => a.id);
  const workloadRows = await db
    .select({ ownerId: leads.ownerId, open: count() })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), inArray(leads.ownerId, eligibleIds), isNull(leads.deletedAt), notInArray(leads.disposition, TERMINAL_DISPOSITIONS)))
    .groupBy(leads.ownerId);
  const openByAgent = new Map(workloadRows.map((r) => [r.ownerId as string, r.open]));

  // Per-agent allowance this cycle = tier batch size, capped by remaining
  // active-lead capacity (company cap AND the agent's own profile cap).
  const allowance = new Map<string, number>();
  for (const agent of eligible) {
    const tier = (agent.tier ?? "1") as TierName;
    const batch = cfg.batchSizePerTier[tier] ?? 1;
    const open = openByAgent.get(agent.id) ?? 0;
    const profileCap = profileFor(profiles, agent.id).capacity.maxActiveLeads;
    const cap = cfg.maxActiveLeads == null ? profileCap : profileCap == null ? cfg.maxActiveLeads : Math.min(cfg.maxActiveLeads, profileCap);
    const remainingCapacity = cap == null ? Number.POSITIVE_INFINITY : Math.max(0, cap - open);
    const n = Math.min(batch, remainingCapacity);
    if (n > 0) allowance.set(agent.id, n);
  }
  if (allowance.size === 0) {
    logger.debug("progressive_cycle_idle", { companyId, backlog: backlogNow, reason: "all_agents_at_capacity" });
    return { ran: true, assigned: 0, attempted: 0, backlog: backlogNow, target: 0, released: state.releasedCount, eligibleAgents: eligible.length };
  }

  // ── Wave + reserve ────────────────────────────────────────────────────────
  // Open a wave if none is active; grow its high-water mark if leads arrived
  // mid-wave (so the reserve is always a share of everything this wave saw).
  const waveOpen = state.waveStartedAt !== null;
  const initialBacklog = Math.max(waveOpen ? state.initialBacklog : 0, state.releasedCount + backlogNow);
  const participation = totalAssignable === 0 ? 0 : eligible.length / totalAssignable;
  const target = releasableTarget(initialBacklog, cfg.reservedBacklogPercent, participation);
  const globalAllowance = Math.max(0, Math.min(target - state.releasedCount, backlogNow));
  const perAgentTotal = [...allowance.values()].reduce((s, n) => s + n, 0);
  const toRelease = Math.min(globalAllowance, perAgentTotal);

  if (!waveOpen || initialBacklog !== state.initialBacklog) {
    await db
      .update(progressiveReleaseState)
      .set({ waveStartedAt: state.waveStartedAt ?? new Date(), initialBacklog, updatedAt: new Date() })
      .where(eq(progressiveReleaseState.companyId, companyId));
  }
  if (toRelease === 0) {
    logger.info("progressive_cycle_held", { companyId, backlog: backlogNow, target, released: state.releasedCount, participation: Math.round(participation * 100) / 100 });
    return { ran: true, assigned: 0, attempted: 0, backlog: backlogNow, target, released: state.releasedCount, eligibleAgents: eligible.length };
  }

  // ── Release ───────────────────────────────────────────────────────────────
  // Leads in the sweep's exact order; each one assigned by the EXISTING
  // pipeline restricted to agents that still hold allowance. Deterministic
  // fairness: the allowance list starts ordered by longest-since-last-assigned.
  const batch = await db
    .select({ id: leads.id, requiredSkillId: leads.requiredSkillId })
    .from(leads)
    .where(backlogWhere(companyId))
    .orderBy(desc(sql`${leads.priority} = 'high'`), asc(leads.createdAt))
    .limit(toRelease);

  const receivedByAgent = new Map<string, number>();
  let assigned = 0;
  let attempted = 0;
  for (const lead of batch) {
    const holders = eligible.filter((a) => (allowance.get(a.id) ?? 0) > 0).map((a) => a.id);
    if (holders.length === 0) break;
    attempted++;
    const res = await assignmentEngine.assign({
      leadId: lead.id,
      companyId,
      requiredSkillId: lead.requiredSkillId,
      source: "progressive",
      allowedAgentIds: holders,
    });
    if (res.outcome === "assigned" && res.agentId) {
      assigned++;
      allowance.set(res.agentId, (allowance.get(res.agentId) ?? 1) - 1);
      receivedByAgent.set(res.agentId, (receivedByAgent.get(res.agentId) ?? 0) + 1);
    } else if (res.outcome === "claim_lost") {
      continue; // someone else (arrival path / another instance) took this lead — fine
    } else {
      // Pool-level wall (auto-assign off, outside hours, everyone filtered):
      // every remaining lead would hit the same wall this cycle.
      break;
    }
  }

  const releasedTotal = state.releasedCount + assigned;
  if (assigned > 0) {
    await db
      .update(progressiveReleaseState)
      .set({ releasedCount: releasedTotal, updatedAt: new Date() })
      .where(eq(progressiveReleaseState.companyId, companyId));
    metrics.increment("assignment.progressive_released", assigned);

    // Audit the batch: what was released, to whom, and the exact numbers the
    // decision was made from — a manager can reconstruct the whole cycle.
    await recordAudit({
      companyId,
      userId: null,
      action: "assignment.progressive_cycle",
      entityType: "progressive_release",
      entityId: companyId,
      metadata: {
        assigned,
        attempted,
        backlogBefore: backlogNow,
        backlogAfter: backlogNow - assigned,
        waveInitialBacklog: initialBacklog,
        waveReleasedTotal: releasedTotal,
        releasableTarget: target,
        reservedPercent: cfg.reservedBacklogPercent,
        participation: Math.round(participation * 1000) / 1000,
        onlineEligible: eligible.length,
        totalAgents: totalAssignable,
        intervalMinutes: cfg.releaseIntervalMinutes,
        perAgent: eligible
          .filter((a) => receivedByAgent.has(a.id))
          .map((a) => ({ agentId: a.id, tier: a.tier ?? "1", received: receivedByAgent.get(a.id) })),
      },
    });
  }

  metrics.recordTiming("assignment.progressive_cycle_ms", Date.now() - startedAt);
  logger.info("progressive_cycle_done", {
    companyId, assigned, attempted, backlog: backlogNow - assigned, target, releasedTotal,
    eligible: eligible.length, totalAgents: totalAssignable, ms: Date.now() - startedAt,
  });
  return { ran: true, assigned, attempted, backlog: backlogNow - assigned, target, released: releasedTotal, eligibleAgents: eligible.length };
}

// Read-only wave status for the settings UI (one-shot on page load — not a
// polling surface).
export async function getProgressiveStatus(companyId: string) {
  const [{ n: backlog }] = await db.select({ n: count() }).from(leads).where(backlogWhere(companyId));
  const [state] = await db.select().from(progressiveReleaseState).where(eq(progressiveReleaseState.companyId, companyId)).limit(1);
  return {
    backlog,
    waveActive: !!state?.waveStartedAt,
    waveInitialBacklog: state?.initialBacklog ?? 0,
    waveReleased: state?.releasedCount ?? 0,
    lastCycleAt: state?.lastCycleAt ?? null,
    nextReleaseAt: state?.nextReleaseAt ?? null,
  };
}
