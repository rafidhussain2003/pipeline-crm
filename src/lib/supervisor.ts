// Supervisor Command Center actions — force assign/reassign, force
// recycle, lock/unlock an agent. Each is a small, direct operation on
// existing tables (users, leads, assignment_log) plus an audit trail
// entry; no new infrastructure, reusing the exact same assignment_log /
// audit_log shape the automatic assignment engine already writes so
// reporting and the lead timeline don't need to know which path a lead
// came through.
import { db } from "@/db";
import { users, leads, assignmentLog } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "./audit";
import { metrics } from "./infra/metrics";
import { createLogger } from "./logger";
import { assignLead } from "./assignment";

const logger = createLogger({ component: "supervisor" });

export async function lockAgent(userId: string, companyId: string, actorUserId: string) {
  const [updated] = await db
    .update(users)
    .set({ locked: true })
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .returning();
  if (!updated) return null;
  await recordAudit({ companyId, userId: actorUserId, action: "agent.locked", entityType: "user", entityId: userId });
  logger.info("agent_locked", { userId });
  return updated;
}

export async function unlockAgent(userId: string, companyId: string, actorUserId: string) {
  const [updated] = await db
    .update(users)
    .set({ locked: false })
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .returning();
  if (!updated) return null;
  await recordAudit({ companyId, userId: actorUserId, action: "agent.unlocked", entityType: "user", entityId: userId });
  logger.info("agent_unlocked", { userId });
  return updated;
}

type SupervisorResult<T> = { ok: true; value: T } | { ok: false; error: string };

// Force assign/reassign — a supervisor override. Deliberately bypasses
// every routing filter (a supervisor picking a specific agent by name is
// an explicit decision, not something routing rules should second-guess),
// but still writes the same assignment_log + audit trail as automatic
// assignment.
export async function forceAssignLead(
  leadId: string,
  companyId: string,
  agentId: string,
  actorUserId: string
): Promise<SupervisorResult<{ ownerId: string }>> {
  const [agent] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, agentId), eq(users.companyId, companyId)))
    .limit(1);
  if (!agent) return { ok: false, error: "Agent not found in this company." };

  const [before] = await db
    .select({ ownerId: leads.ownerId })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);
  if (!before) return { ok: false, error: "Lead not found." };

  const [updated] = await db
    .update(leads)
    .set({ ownerId: agentId, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .returning({ id: leads.id });
  if (!updated) return { ok: false, error: "Lead not found." };

  await db.insert(assignmentLog).values({ leadId, assignedTo: agentId, ruleUsed: "manual:supervisor" });

  await recordAudit({
    companyId,
    userId: actorUserId,
    action: "lead.reassigned",
    entityType: "lead",
    entityId: leadId,
    before: { ownerId: before.ownerId },
    after: { ownerId: agentId },
    metadata: { via: "supervisor_force_assign" },
  });

  metrics.increment("supervisor.force_assigned");
  logger.info("force_assigned", { leadId, agentId });
  return { ok: true, value: { ownerId: agentId } };
}

// Force recycle — immediately re-routes a lead away from its current
// owner, ignoring the configured recycleAfterMinutes wait (that's for the
// automatic cron; a supervisor acting directly doesn't need to wait for
// it). Goes through assignLead() itself, so it's still subject to the
// exact same eligibility filters (presence, hours, workload, skill,
// locked) as any other assignment — a supervisor forcing a recycle still
// can't route to an offline or locked agent.
export async function forceRecycleLead(leadId: string, companyId: string, actorUserId: string): Promise<SupervisorResult<{ agentId: string }>> {
  const [lead] = await db
    .select({ ownerId: leads.ownerId, recycleCount: leads.recycleCount, requiredSkillId: leads.requiredSkillId })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);
  if (!lead) return { ok: false, error: "Lead not found." };

  const newOwner = await assignLead(leadId, companyId, lead.requiredSkillId, lead.ownerId);
  if (!newOwner) return { ok: false, error: "No eligible agent available to recycle to right now." };

  // Atomic increment (SET recycle_count = recycle_count + 1) rather than
  // reading the count then writing back a JS-computed value — the recycle
  // cron can run concurrently with a supervisor force-recycling the same
  // lead, and a read-then-write would let one increment silently overwrite
  // the other (lost update).
  await db.update(leads).set({ recycleCount: sql`${leads.recycleCount} + 1` }).where(eq(leads.id, leadId));

  await recordAudit({
    companyId,
    userId: actorUserId,
    action: "lead.force_recycled",
    entityType: "lead",
    entityId: leadId,
    metadata: { from: lead.ownerId, to: newOwner },
  });

  metrics.increment("supervisor.force_recycled");
  logger.info("force_recycled", { leadId, from: lead.ownerId, to: newOwner });
  return { ok: true, value: { agentId: newOwner } };
}
