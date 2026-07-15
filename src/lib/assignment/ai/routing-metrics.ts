// Phase 5 routing analytics — backend metrics only (no UI). Everything is
// derived from data the engine already persists (assignment_history, leads,
// skills, decision_detail) over a bounded window, plus process-lifetime
// counters. Cheap to compute on demand.
import { db } from "@/db";
import { assignmentHistory, leads, skills, userSkills, users } from "@/db/schema";
import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { metrics } from "@/lib/infra/metrics";
import { getQueueConfig } from "@/lib/lifecycle/config";
import { classifyLeadSla } from "@/lib/lifecycle/sla";

const WINDOW_HOURS = 24;
const DETAIL_SAMPLE = 500;

export interface RoutingMetrics {
  windowHours: number;
  tierUtilization: { tier: string; assignments: number }[];
  skillCoverage: { skill: string; agents: number }[];
  capacity: { eligibleAgents: number; avgActiveLeadsPerAgent: number | null };
  sla: { total: number; met: number; complianceRate: number | null; avgAssignmentDelaySeconds: number | null };
  avgSkillMatch: number | null; // avg skill factor score of the chosen agent
  fallbackRate: number | null; // skill-fallback assignments / total assignments (process-lifetime)
  escalations: number; // process-lifetime
}

export async function getRoutingMetrics(companyId: string): Promise<RoutingMetrics> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000);

  // Assignments per tier (24h).
  const tierRows = await db
    .select({ tier: users.tier, n: sql<number>`count(*)::int` })
    .from(assignmentHistory)
    .innerJoin(users, eq(users.id, assignmentHistory.assignedTo))
    .where(and(eq(assignmentHistory.companyId, companyId), eq(assignmentHistory.outcome, "assigned"), gte(assignmentHistory.createdAt, since)))
    .groupBy(users.tier);
  const tierUtilization = tierRows.map((r) => ({ tier: r.tier ?? "1", assignments: Number(r.n) })).sort((a, b) => b.assignments - a.assignments);

  // Skill coverage: how many agents hold each skill.
  const skillRows = await db
    .select({ label: skills.label, n: sql<number>`count(${userSkills.userId})::int` })
    .from(skills)
    .leftJoin(userSkills, eq(userSkills.skillId, skills.id))
    .where(eq(skills.companyId, companyId))
    .groupBy(skills.id, skills.label);
  const skillCoverage = skillRows.map((r) => ({ skill: r.label, agents: Number(r.n) })).sort((a, b) => b.agents - a.agents);

  // Capacity utilization: avg open (non-terminal) leads per agent who has any.
  const openRows = await db
    .select({ ownerId: leads.ownerId, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), isNotNull(leads.ownerId), isNull(leads.deletedAt)))
    .groupBy(leads.ownerId);
  const avgActive = openRows.length > 0 ? openRows.reduce((a, r) => a + Number(r.n), 0) / openRows.length : null;

  // SLA compliance + avg assignment delay over recently-assigned leads.
  const config = await getQueueConfig(companyId);
  const assignedLeads = await db
    .select({ priority: leads.priority, createdAt: leads.createdAt, assignedAt: leads.assignedAt })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), isNotNull(leads.assignedAt), gte(leads.assignedAt, since)))
    .limit(5000);
  let met = 0;
  let delaySum = 0;
  for (const l of assignedLeads) {
    if (!l.assignedAt) continue;
    const delayMs = l.assignedAt.getTime() - l.createdAt.getTime();
    delaySum += delayMs;
    const target = classifyLeadSla({ priority: l.priority, createdAt: l.createdAt }, config).targetSeconds;
    if (delayMs <= target * 1000) met++;
  }
  const total = assignedLeads.length;

  // Avg skill match of the winner (sampled from decision_detail.chosen.topReasons "skill=x").
  const detailRows = await db
    .select({ detail: assignmentHistory.decisionDetail })
    .from(assignmentHistory)
    .where(and(eq(assignmentHistory.companyId, companyId), isNotNull(assignmentHistory.decisionDetail), gte(assignmentHistory.createdAt, since)))
    .orderBy(desc(assignmentHistory.createdAt))
    .limit(DETAIL_SAMPLE);
  let skillSum = 0;
  let skillN = 0;
  for (const row of detailRows) {
    const reasons = (row.detail as { chosen?: { topReasons?: string[] } } | null)?.chosen?.topReasons ?? [];
    const skillReason = reasons.find((r) => r.startsWith("skill="));
    if (skillReason) {
      const v = Number(skillReason.split("=")[1]);
      if (!Number.isNaN(v)) { skillSum += v; skillN++; }
    }
  }

  const snap = metrics.snapshot();
  const assignedCounter = snap["assignment.assigned"];
  return {
    windowHours: WINDOW_HOURS,
    tierUtilization,
    skillCoverage,
    capacity: { eligibleAgents: openRows.length, avgActiveLeadsPerAgent: avgActive != null ? Math.round(avgActive * 100) / 100 : null },
    sla: {
      total,
      met,
      complianceRate: total > 0 ? Math.round((met / total) * 1000) / 1000 : null,
      avgAssignmentDelaySeconds: total > 0 ? Math.round(delaySum / total / 1000) : null,
    },
    avgSkillMatch: skillN > 0 ? Math.round((skillSum / skillN) * 1000) / 1000 : null,
    fallbackRate: assignedCounter > 0 ? Math.round((snap["assignment.skill_fallback"] / assignedCounter) * 1000) / 1000 : null,
    escalations: snap["assignment.sla_escalated"],
  };
}
