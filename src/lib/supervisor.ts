// Supervisor Command Center actions — force assign/reassign, force
// recycle, lock/unlock an agent. Each is a small, direct operation on
// existing tables (users, leads, assignment_log) plus an audit trail
// entry; no new infrastructure, reusing the exact same assignment_log /
// audit_log shape the automatic assignment engine already writes so
// reporting and the lead timeline don't need to know which path a lead
// came through.
import { db } from "@/db";
import { users, leads, assignmentLog } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "./audit";
import { eventBus } from "./events/bus";
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
    .select({ ownerId: leads.ownerId, lifecycleStage: leads.lifecycleStage })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);
  if (!before) return { ok: false, error: "Lead not found." };

  const [updated] = await db
    .update(leads)
    // Stamp the SAME lifecycle state the automatic claim writes: without it
    // a manually assigned lead sat in stage "new"/"queued" with no
    // assignedAt, which the recycle engine read as an unworked lead on an
    // offline agent and quietly un-assigned. Progressed stages are never
    // regressed — reassigning a contacted lead only changes hands.
    .set({
      ownerId: agentId,
      updatedAt: new Date(),
      assignedAt: sql`CASE WHEN ${leads.lifecycleStage} IN ('new','queued','assigned') THEN now() ELSE ${leads.assignedAt} END`,
      lifecycleStage: sql`CASE WHEN ${leads.lifecycleStage} IN ('new','queued') THEN 'assigned'::lifecycle_stage ELSE ${leads.lifecycleStage} END`,
    })
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

// Manual assignment (leads page bulk bar) — one or many leads to one agent.
// Same write discipline as forceAssignLead: ownerId (+updatedAt) is the ONLY
// lead column touched, so Facebook ids, original created time, source, notes,
// tags, disposition, privacy and every other field are structurally untouched.
// Each lead gets its own assignment_log row and its own audit entry (previous
// owner -> new owner), and each emits "lead.assigned" so notifications,
// insights, activity and the leads-page live stream all see it — identical to
// what an automatic assignment produces.
export async function bulkAssignLeads(
  leadIds: string[],
  companyId: string,
  agentId: string,
  actorUserId: string
): Promise<SupervisorResult<{ assignedCount: number; skippedCount: number }>> {
  // Unlike forceAssignLead (supervisor override, any company member), the
  // assign modal only offers active teammates — enforce the same here so a
  // crafted request can't hand leads to a disabled or deleted account.
  const [agent] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, agentId), eq(users.companyId, companyId), eq(users.active, true), isNull(users.deletedAt)))
    .limit(1);
  if (!agent) return { ok: false, error: "That agent is not an active member of this company." };

  // Previous owners are captured BEFORE the write — they are the audit
  // trail's before-state. Company-scoped and soft-delete-aware: ids from
  // another tenant or deleted leads simply drop out and are reported skipped.
  const before = await db
    .select({ id: leads.id, ownerId: leads.ownerId })
    .from(leads)
    .where(and(inArray(leads.id, leadIds), eq(leads.companyId, companyId), isNull(leads.deletedAt)));
  if (before.length === 0) return { ok: false, error: "None of the selected leads were found." };

  const foundIds = before.map((l) => l.id);
  await db
    .update(leads)
    // Same lifecycle stamping as the automatic claim (see forceAssignLead
    // above for why): fresh leads move to "assigned" with assignedAt set;
    // progressed stages are never regressed.
    .set({
      ownerId: agentId,
      updatedAt: new Date(),
      assignedAt: sql`CASE WHEN ${leads.lifecycleStage} IN ('new','queued','assigned') THEN now() ELSE ${leads.assignedAt} END`,
      lifecycleStage: sql`CASE WHEN ${leads.lifecycleStage} IN ('new','queued') THEN 'assigned'::lifecycle_stage ELSE ${leads.lifecycleStage} END`,
    })
    .where(and(inArray(leads.id, foundIds), eq(leads.companyId, companyId)));

  // Every ownerId change must land in assignment_log (round-robin cursor and
  // "assigned today" counts both derive from it) — one row per lead, same as
  // the automatic engine writes.
  await db.insert(assignmentLog).values(foundIds.map((leadId) => ({ leadId, assignedTo: agentId, ruleUsed: "manual:bulk_assign" })));

  for (const lead of before) {
    await recordAudit({
      companyId,
      userId: actorUserId,
      action: "lead.reassigned",
      entityType: "lead",
      entityId: lead.id,
      before: { ownerId: lead.ownerId },
      after: { ownerId: agentId },
      metadata: { via: "manual_bulk_assign", bulkCount: before.length },
    });
    await eventBus.emit("lead.assigned", { leadId: lead.id, companyId, agentId });
  }

  metrics.increment("supervisor.manual_assigned", before.length);
  logger.info("manual_bulk_assigned", { agentId, count: before.length, actorUserId });
  return { ok: true, value: { assignedCount: before.length, skippedCount: leadIds.length - before.length } };
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
