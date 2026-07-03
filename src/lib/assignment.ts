import { db } from "@/db";
import { assignmentLog, assignmentRules, automationSettings, leads, users, userSkills } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

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
 * Every assignment is logged in assignment_log for a full audit trail. This
 * runs synchronously per lead, which is comfortably fast for the
 * thousands-of-leads/day, 20-100-agent scale this was built for. If ingestion
 * volume grows far beyond that, this function can be dropped unchanged into
 * a queue worker (e.g. BullMQ + Redis).
 */
export async function assignLead(leadId: string, companyId: string, requiredSkillId?: string | null, excludeAgentId?: string | null) {
  const [settings] = await db
    .select()
    .from(automationSettings)
    .where(eq(automationSettings.companyId, companyId))
    .limit(1);

  if (settings && !settings.autoAssignEnabled) {
    return null; // auto-assignment toggled off for this company
  }

  let activeAgents = await db
    .select({ id: users.id, tier: users.tier })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.role, "agent"),
        eq(users.active, true),
        isNull(users.deletedAt)
      )
    );

  if (activeAgents.length === 0) return null; // leaves lead unassigned

  if (excludeAgentId) {
    const withoutExcluded = activeAgents.filter((a) => a.id !== excludeAgentId);
    if (withoutExcluded.length > 0) activeAgents = withoutExcluded;
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
    if (eligible.length > 0) activeAgents = eligible;
  }

  const rules = await db
    .select()
    .from(assignmentRules)
    .where(and(eq(assignmentRules.companyId, companyId), eq(assignmentRules.active, true)));

  const weightByTier: Record<string, number> = { "1": 3, "2": 2, "3": 1 };
  for (const r of rules) weightByTier[r.tier] = r.weight;

  const sortedAgents = [...activeAgents].sort((a, b) => (a.tier || "1").localeCompare(b.tier || "1"));
  const cycle: string[] = [];
  for (const agent of sortedAgents) {
    const weight = mode === "round_robin" ? 1 : weightByTier[agent.tier || "1"] ?? 1;
    for (let i = 0; i < weight; i++) cycle.push(agent.id);
  }
  if (cycle.length === 0) return null;

  const assignedCountRows = await db
    .select({ id: assignmentLog.id })
    .from(assignmentLog)
    .innerJoin(leads, eq(assignmentLog.leadId, leads.id))
    .where(eq(leads.companyId, companyId));

  const cursor = assignedCountRows.length % cycle.length;
  const chosenAgentId = cycle[cursor];

  await db.update(leads).set({ ownerId: chosenAgentId, updatedAt: new Date() }).where(eq(leads.id, leadId));
  await db.insert(assignmentLog).values({
    leadId,
    assignedTo: chosenAgentId,
    ruleUsed: `${mode}:cursor=${cursor}`,
  });

  return chosenAgentId;
}
