// Agent feature provider — the data the scoring engine reasons over, fetched
// in BULK and CACHED so the hot assignment path stays in milliseconds.
//
// Per company (not per candidate, not per lead) we fetch two small aggregates
// and cache them briefly; the active-lead count is REUSED from the workload
// map the pipeline already computes for AI mode, so a scored assignment adds
// at most two short, indexed, cache-amortized queries — and zero on a cache
// hit, which is the common case at volume.
import { db } from "@/db";
import { assignmentHistory, leads } from "@/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { WON_DISPOSITIONS } from "@/lib/analytics/kpis";
import { getAgentSkills } from "./skills";
import { getAgentProfiles, profileFor, DEFAULT_AGENT_PROFILE, type AgentProfile } from "./agent-profile";

export interface AgentFeatures {
  activeLeads: number; // current OPEN non-terminal leads (reused from the pipeline's workload map)
  todayCount: number; // assignments received today (fairness / daily cap)
  wonCount: number; // lifetime won leads owned
  totalCount: number; // lifetime leads owned
  closeRate: number; // wonCount / totalCount, 0 when no history
  skills: Set<string>; // Phase 5: this agent's skill ids
  profile: AgentProfile; // Phase 5: per-agent capacity + schedule
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0); // server-local midnight, same convention as analytics
  return d;
}

// Today's assignment counts per agent. Short TTL — fairness cares about "roughly
// now", and a 20s stale count across a burst of leads is fine and self-corrects.
async function todayCounts(companyId: string): Promise<Map<string, number>> {
  return cache.getOrSet(`ai-today:${companyId}`, 20_000, async () => {
    const rows = await db
      .select({ agent: assignmentHistory.assignedTo, n: sql<number>`count(*)::int` })
      .from(assignmentHistory)
      .where(
        and(
          eq(assignmentHistory.companyId, companyId),
          eq(assignmentHistory.outcome, "assigned"),
          gte(assignmentHistory.createdAt, startOfToday())
        )
      )
      .groupBy(assignmentHistory.assignedTo);
    const m = new Map<string, number>();
    for (const r of rows) if (r.agent) m.set(r.agent, Number(r.n));
    return m;
  });
}

// Lifetime won/total per agent (close-rate performance signal). Longer TTL —
// close rate barely moves lead to lead.
async function closeStats(companyId: string): Promise<Map<string, { won: number; total: number }>> {
  return cache.getOrSet(`ai-close:${companyId}`, 60_000, async () => {
    const rows = await db
      .select({
        owner: leads.ownerId,
        total: sql<number>`count(*)::int`,
        won: sql<number>`count(*) filter (where ${inArray(leads.disposition, WON_DISPOSITIONS)})::int`,
      })
      .from(leads)
      .where(and(eq(leads.companyId, companyId), sql`${leads.ownerId} is not null`, sql`${leads.deletedAt} is null`))
      .groupBy(leads.ownerId);
    const m = new Map<string, { won: number; total: number }>();
    for (const r of rows) if (r.owner) m.set(r.owner, { won: Number(r.won), total: Number(r.total) });
    return m;
  });
}

export async function getAgentFeatures(
  companyId: string,
  agentIds: string[],
  workloadByAgent: Map<string, number>
): Promise<Map<string, AgentFeatures>> {
  // All four lookups are cached per company, so this is at most a handful of
  // short queries on a cold cache and zero on a warm one.
  const [today, close, skills, profiles] = await Promise.all([
    todayCounts(companyId),
    closeStats(companyId),
    getAgentSkills(companyId),
    getAgentProfiles(companyId),
  ]);
  const out = new Map<string, AgentFeatures>();
  for (const id of agentIds) {
    const c = close.get(id) ?? { won: 0, total: 0 };
    out.set(id, {
      activeLeads: workloadByAgent.get(id) ?? 0,
      todayCount: today.get(id) ?? 0,
      wonCount: c.won,
      totalCount: c.total,
      closeRate: c.total > 0 ? c.won / c.total : 0,
      skills: skills.get(id) ?? new Set(),
      profile: profileFor(profiles, id),
    });
  }
  return out;
}

export { DEFAULT_AGENT_PROFILE };
