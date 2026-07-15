// The lead lifecycle service — the SINGLE writer of leads.lifecycle_stage and
// the ONLY thing that appends to lead_lifecycle_events. "Nothing should
// silently change state": every stage change goes through here, producing one
// timestamped audit row and one event.
//
// Two entry points, same audit trail:
//   transitionLifecycle()   — reads current stage, guards, updates the stage,
//                             records the event. For standalone transitions
//                             (recycling, rebalancing, disposition changes).
//   recordStageEvent()      — records the event only, for the hot assignment
//                             path where the stage was already set atomically
//                             inside the claim UPDATE (avoids an extra write in
//                             the per-company lock).
import { db } from "@/db";
import { leadLifecycleEvents, leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { eventBus } from "@/lib/events/bus";
import { createLogger } from "@/lib/logger";
import type { LifecycleStage } from "./stages";

const logger = createLogger({ component: "lifecycle" });

export interface TransitionParams {
  leadId: string;
  companyId: string;
  toStage: LifecycleStage;
  reason?: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  // Optimistic guard: only transition if the lead is currently in one of these
  // stages (prevents e.g. recycling a lead an agent just won).
  onlyFrom?: LifecycleStage[];
}

export async function transitionLifecycle(params: TransitionParams): Promise<{ changed: boolean; from: LifecycleStage | null }> {
  const { leadId, companyId, toStage } = params;
  const [current] = await db.select({ stage: leads.lifecycleStage }).from(leads).where(eq(leads.id, leadId)).limit(1);
  const from = (current?.stage as LifecycleStage | undefined) ?? null;

  if (from === toStage) return { changed: false, from };
  if (params.onlyFrom && from && !params.onlyFrom.includes(from)) return { changed: false, from };

  const set: Record<string, unknown> = { lifecycleStage: toStage };
  if (toStage === "assigned") set.assignedAt = new Date();

  await db.update(leads).set(set).where(eq(leads.id, leadId));
  await writeEvent(companyId, leadId, from, toStage, params.reason ?? null, params.actorUserId ?? null, params.metadata ?? null);
  return { changed: true, from };
}

// Event-only recording — the stage was already persisted by the caller (the
// assignment claim). Keeps the per-company lock free of an extra round-trip
// while still funneling the audit through this one place.
export async function recordStageEvent(params: {
  leadId: string;
  companyId: string;
  from: LifecycleStage | null;
  toStage: LifecycleStage;
  reason?: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (params.from === params.toStage) return;
  await writeEvent(params.companyId, params.leadId, params.from, params.toStage, params.reason ?? null, params.actorUserId ?? null, params.metadata ?? null);
}

async function writeEvent(
  companyId: string,
  leadId: string,
  from: LifecycleStage | null,
  to: LifecycleStage,
  reason: string | null,
  actorUserId: string | null,
  metadata: Record<string, unknown> | null
): Promise<void> {
  await db.insert(leadLifecycleEvents).values({ companyId, leadId, fromStage: from, toStage: to, reason, actorUserId, metadata });
  logger.debug("lifecycle_transition", { leadId, from, to, reason });
  await eventBus.emit("lead.lifecycle_changed", { leadId, companyId, from, to, reason });
}
