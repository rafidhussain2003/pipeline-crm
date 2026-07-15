// AI workload rebalancing (Phase 4) — continuously levels load across eligible
// agents so one agent isn't buried while another sits idle (the "70 vs 3"
// case), WITHOUT ever stealing a live conversation.
//
// Only NON-active leads move: a lead in lifecycle "assigned" (routed but not
// yet contacted) can be handed to a less-loaded agent; anything the agent has
// engaged (contacted/in_progress/follow_up) or finished (terminal) is left
// alone. Every move is atomic (guarded on still-owned + still-"assigned") so a
// lead the agent picks up mid-rebalance is never taken. Bounded per run.
import { db } from "@/db";
import { automationSettings, leads, users } from "@/db/schema";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { presenceService } from "@/lib/presence/service";
import { TERMINAL_DISPOSITIONS } from "@/lib/assignment/constants";
import { eventBus } from "@/lib/events/bus";
import { recordAudit } from "@/lib/audit";
import { metrics } from "@/lib/infra/metrics";
import { createLogger } from "@/lib/logger";
import { getQueueConfig } from "./config";

const logger = createLogger({ component: "rebalancing" });

export async function rebalanceCompany(companyId: string): Promise<{ moved: number }> {
  const config = await getQueueConfig(companyId);
  if (!config.rebalance.enabled) return { moved: 0 };
  const rb = config.rebalance;

  const [settings] = await db
    .select({ hb: automationSettings.heartbeatTimeoutSeconds })
    .from(automationSettings)
    .where(eq(automationSettings.companyId, companyId))
    .limit(1);
  const hbTimeout = settings?.hb ?? 90;

  // Only balance across agents who could actually take a lead right now.
  const roster = await presenceService.getRoster(companyId);
  const { assignable } = presenceService.filterEligible(roster, hbTimeout);
  if (assignable.length < 2) return { moved: 0 };
  const eligibleIds = assignable.map((a) => a.id);

  // Current workload (open, non-terminal) per eligible agent.
  const wl = await db
    .select({ ownerId: leads.ownerId, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), inArray(leads.ownerId, eligibleIds), isNull(leads.deletedAt), notInArray(leads.disposition, TERMINAL_DISPOSITIONS)))
    .groupBy(leads.ownerId);
  const load = new Map<string, number>(eligibleIds.map((id) => [id, 0]));
  for (const r of wl) if (r.ownerId) load.set(r.ownerId, Number(r.n));

  let moved = 0;
  for (let i = 0; i < rb.maxMovesPerRun; i++) {
    const entries = [...load.entries()].sort((a, b) => b[1] - a[1]);
    const [maxId, maxN] = entries[0];
    const [minId, minN] = entries[entries.length - 1];
    if (maxId === minId || maxN - minN < rb.minImbalance) break;

    // One movable (non-active, "assigned") lead from the overloaded agent.
    const [movable] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.companyId, companyId), eq(leads.ownerId, maxId), eq(leads.lifecycleStage, "assigned"), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    if (!movable) break; // overloaded agent's leads are all active — can't rebalance further

    // Atomic hand-off: only if still owned by the overloaded agent AND still
    // "assigned" (not contacted since) — never steals a now-active lead.
    const res = await db
      .update(leads)
      .set({ ownerId: minId, assignedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(leads.id, movable.id), eq(leads.ownerId, maxId), eq(leads.lifecycleStage, "assigned")))
      .returning({ id: leads.id });
    if (res.length === 0) continue;

    await db.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, minId));
    await eventBus.emit("lead.rebalanced", { leadId: movable.id, companyId, fromAgentId: maxId, toAgentId: minId });
    await recordAudit({ companyId, userId: null, action: "lead.rebalanced", entityType: "lead", entityId: movable.id, metadata: { from: maxId, to: minId } });
    load.set(maxId, maxN - 1);
    load.set(minId, minN + 1);
    moved++;
  }

  if (moved > 0) {
    metrics.increment("assignment.rebalanced", moved);
    logger.info("rebalanced", { companyId, moved });
  }
  return { moved };
}

// Rebalance every company that has opted in via queue_config.rebalance.enabled.
export async function rebalanceAllCompanies(): Promise<{ companies: number; moved: number }> {
  const rows = await db.execute(sql`
    SELECT company_id FROM automation_settings WHERE (queue_config #>> '{rebalance,enabled}') = 'true'
  `);
  const companyIds = ((rows as unknown as { rows: { company_id: string }[] }).rows ?? []).map((r) => r.company_id);
  let totalMoved = 0;
  for (const companyId of companyIds) {
    const { moved } = await rebalanceCompany(companyId);
    totalMoved += moved;
  }
  return { companies: companyIds.length, moved: totalMoved };
}
