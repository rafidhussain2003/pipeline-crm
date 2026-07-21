// Intelligent recycling (Phase 4) — autonomously takes leads back from agents
// who can't work them and re-queues them through the assignment engine, with
// zero manager involvement.
//
// Recycle triggers (all configurable, see QueueConfig.recycle):
//   • agent unavailable  — owner removed/suspended/locked (recycled even if the
//                          lead was active; the agent is gone)
//   • sla_exceeded       — assigned but never contacted within slaMinutes
//   • agent_offline      — owner offline/stale beyond agentOfflineMinutes
//   • untouched          — no update for untouchedMinutes
// Active leads (contacted/in_progress/follow_up) are NEVER recycled by the
// last three triggers (never steal a live conversation) unless
// recycleActiveLeads is on. maxRecycleCount caps churn per lead.
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { assignmentEngine } from "@/lib/assignment/engine";
import { TERMINAL_DISPOSITIONS } from "@/lib/assignment/constants";
import { manuallyAssignedLeadIds } from "@/lib/assignment/manual";
import { ELIGIBLE_PRESENCE_STATUSES } from "@/lib/presence/status";
import { eventBus } from "@/lib/events/bus";
import { recordAudit } from "@/lib/audit";
import { metrics } from "@/lib/infra/metrics";
import { createLogger } from "@/lib/logger";
import { getQueueConfig } from "./config";
import { recordStageEvent } from "./service";
import { isActiveStage, TERMINAL_STAGES, type LifecycleStage } from "./stages";

const logger = createLogger({ component: "recycling" });
const SCAN_LIMIT = 1000; // owned leads examined per company per run

function ownerOfflineTooLong(presence: string | null, heartbeat: Date | null, offlineMinutes: number, now: number): boolean {
  if (!presence || !ELIGIBLE_PRESENCE_STATUSES.includes(presence as (typeof ELIGIBLE_PRESENCE_STATUSES)[number])) return true;
  if (!heartbeat) return true;
  return now - heartbeat.getTime() > offlineMinutes * 60_000;
}

export async function recycleCompany(companyId: string): Promise<{ recycled: number; scanned: number }> {
  const config = await getQueueConfig(companyId);
  if (!config.recycle.enabled) return { recycled: 0, scanned: 0 };
  const r = config.recycle;
  const now = Date.now();

  const rows = await db
    .select({
      id: leads.id,
      ownerId: leads.ownerId,
      lifecycleStage: leads.lifecycleStage,
      assignedAt: leads.assignedAt,
      updatedAt: leads.updatedAt,
      recycleCount: leads.recycleCount,
      requiredSkillId: leads.requiredSkillId,
      ownerDeletedAt: users.deletedAt,
      ownerActive: users.active,
      ownerLocked: users.locked,
      ownerPresence: users.presenceStatus,
      ownerHeartbeat: users.lastHeartbeatAt,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(
      and(
        eq(leads.companyId, companyId),
        sql`${leads.ownerId} is not null`,
        isNull(leads.deletedAt),
        eq(leads.isBlacklisted, false),
        notInArray(leads.disposition, TERMINAL_DISPOSITIONS),
        notInArray(leads.lifecycleStage, TERMINAL_STAGES),
        sql`${leads.recycleCount} < ${r.maxRecycleCount}`
      )
    )
    .limit(SCAN_LIMIT);

  const toRecycle: { id: string; ownerId: string; requiredSkillId: string | null; stage: LifecycleStage; reason: string; ownerGoneHard: boolean }[] = [];
  for (const lead of rows) {
    if (!lead.ownerId) continue;
    const stage = lead.lifecycleStage as LifecycleStage;
    const active = isActiveStage(stage);
    const ownerGone = lead.ownerDeletedAt != null || lead.ownerActive === false || lead.ownerLocked === true;
    // "Hard" gone = the account no longer exists as a working identity
    // (deleted/deactivated) — as opposed to a temporary lock.
    const ownerGoneHard = lead.ownerDeletedAt != null || lead.ownerActive === false;

    let reason: string | null = null;
    if (ownerGone) {
      reason = "agent_unavailable"; // the agent is gone — recycle even if active
    } else if (!active || r.recycleActiveLeads) {
      if (stage === "assigned" && lead.assignedAt && now - lead.assignedAt.getTime() > r.slaMinutes * 60_000) {
        reason = "sla_exceeded";
      } else if (ownerOfflineTooLong(lead.ownerPresence, lead.ownerHeartbeat, r.agentOfflineMinutes, now)) {
        reason = "agent_offline";
      } else if (now - lead.updatedAt.getTime() > r.untouchedMinutes * 60_000) {
        reason = "untouched";
      }
    }
    if (reason) toRecycle.push({ id: lead.id, ownerId: lead.ownerId, requiredSkillId: lead.requiredSkillId, stage, reason, ownerGoneHard });
  }

  // A MANUAL assignment is an explicit human decision — the engine never
  // second-guesses it. Manually assigned leads (latest assignment_log entry
  // is a manual:* rule) stay with their agent through offline/SLA/untouched
  // windows; the ONLY thing that releases them automatically is the owner
  // account itself being deleted or deactivated. Engine-assigned leads keep
  // the exact recycle rules they always had.
  const manualIds = await manuallyAssignedLeadIds(toRecycle.map((i) => i.id));
  let manualSkipped = 0;

  let recycled = 0;
  for (const item of toRecycle) {
    if (manualIds.has(item.id) && !item.ownerGoneHard) {
      manualSkipped++;
      continue;
    }
    // Atomic release: only if STILL owned by the same agent and NOT already
    // moved to a terminal/active stage since we scanned — prevents recycling a
    // lead the agent just acted on (never steal a live conversation).
    const released = await db
      .update(leads)
      .set({ ownerId: null, lifecycleStage: "queued", recycleCount: sql`${leads.recycleCount} + 1`, updatedAt: new Date() })
      .where(and(eq(leads.id, item.id), eq(leads.ownerId, item.ownerId), eq(leads.lifecycleStage, item.stage)))
      .returning({ id: leads.id });
    if (released.length === 0) continue;

    await recordStageEvent({ leadId: item.id, companyId, from: item.stage, toStage: "queued", reason: `recycled:${item.reason}`, metadata: { fromAgentId: item.ownerId } });
    await eventBus.emit("lead.recycled", { leadId: item.id, companyId, fromAgentId: item.ownerId });
    await recordAudit({ companyId, userId: null, action: "lead.auto_recycled", entityType: "lead", entityId: item.id, metadata: { from: item.ownerId, reason: item.reason } });
    // Re-queue through the engine, excluding the previous owner so it doesn't
    // bounce straight back to them.
    await assignmentEngine.enqueue({ leadId: item.id, companyId, requiredSkillId: item.requiredSkillId, excludeAgentId: item.ownerId, source: "recycle" });
    recycled++;
  }

  if (recycled > 0 || manualSkipped > 0) {
    metrics.increment("assignment.recycled", recycled);
    logger.info("recycled", { companyId, recycled, manualSkipped, scanned: rows.length });
  }
  return { recycled, scanned: rows.length };
}

// Recycle every company that has recycling enabled (via the existing
// autoRecycleEnabled flag OR a queue_config override). Bounded per company.
//
// Single-flight per process: an overlapping cron tick (previous pass still
// scanning a large tenant set) skips instead of running the same scans and
// racing the same atomic releases — every recycle decision stays identical,
// only the duplicate pass is eliminated. The next tick covers the rest.
let recyclePassRunning = false;
export async function recycleAllCompanies(): Promise<{ companies: number; recycled: number }> {
  if (recyclePassRunning) {
    metrics.increment("assignment.overlap_skipped");
    logger.warn("recycle_pass_overlap_skipped", {});
    return { companies: 0, recycled: 0 };
  }
  recyclePassRunning = true;
  try {
    return await runRecyclePass();
  } finally {
    recyclePassRunning = false;
  }
}

async function runRecyclePass(): Promise<{ companies: number; recycled: number }> {
  const rows = await db.execute(sql`
    SELECT company_id FROM automation_settings
    WHERE auto_recycle_enabled = true OR (queue_config #>> '{recycle,enabled}') = 'true'
  `);
  const companyIds = ((rows as unknown as { rows: { company_id: string }[] }).rows ?? []).map((r) => r.company_id);
  let totalRecycled = 0;
  for (const companyId of companyIds) {
    const { recycled } = await recycleCompany(companyId);
    totalRecycled += recycled;
  }
  return { companies: companyIds.length, recycled: totalRecycled };
}
