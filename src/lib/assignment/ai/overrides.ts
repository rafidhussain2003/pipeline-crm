// Agent overrides (Phase 5) — temporary, auto-expiring manual routing controls.
// Expiry is enforced at READ time (WHERE expires_at > now), so an override
// simply stops applying the instant it lapses — no cleanup job.
import { db } from "@/db";
import { agentOverrides } from "@/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";

export type OverrideType = "pause" | "lock" | "reserve" | "force" | "capacity_boost";

export interface ActiveOverrides {
  blocked: Set<string>; // pause + lock -> skip these agents
  reservedAgentId: string | null; // reserve/force -> route ONLY to this agent (if eligible)
  capacityBoost: Map<string, number>; // agentId -> extra max-active-leads
}

// Resolved active overrides for a company, cached briefly so a lapse takes
// effect within seconds without hammering the DB.
export async function getActiveOverrides(companyId: string): Promise<ActiveOverrides> {
  return cache.getOrSet(`agent-overrides:${companyId}`, 5_000, async () => {
    const rows = await db
      .select()
      .from(agentOverrides)
      .where(and(eq(agentOverrides.companyId, companyId), gt(agentOverrides.expiresAt, new Date())))
      .orderBy(desc(agentOverrides.createdAt));
    const result: ActiveOverrides = { blocked: new Set(), reservedAgentId: null, capacityBoost: new Map() };
    for (const o of rows) {
      if (!o.agentId) continue;
      if (o.type === "pause" || o.type === "lock") result.blocked.add(o.agentId);
      else if ((o.type === "reserve" || o.type === "force") && !result.reservedAgentId) result.reservedAgentId = o.agentId;
      else if (o.type === "capacity_boost") {
        const boost = Number((o.value as { boost?: number } | null)?.boost ?? 0);
        if (boost > 0) result.capacityBoost.set(o.agentId, (result.capacityBoost.get(o.agentId) ?? 0) + boost);
      }
    }
    return result;
  });
}

export async function createOverride(params: {
  companyId: string;
  agentId: string;
  type: OverrideType;
  ttlSeconds: number;
  value?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(agentOverrides)
    .values({
      companyId: params.companyId,
      agentId: params.agentId,
      type: params.type,
      value: params.value ?? null,
      expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
      createdBy: params.createdBy ?? null,
    })
    .returning({ id: agentOverrides.id });
  await cache.delete(`agent-overrides:${params.companyId}`);
  return row.id;
}

export async function clearOverride(companyId: string, id: string): Promise<void> {
  await db.delete(agentOverrides).where(and(eq(agentOverrides.id, id), eq(agentOverrides.companyId, companyId)));
  await cache.delete(`agent-overrides:${companyId}`);
}

export async function listActiveOverrides(companyId: string) {
  return db
    .select()
    .from(agentOverrides)
    .where(and(eq(agentOverrides.companyId, companyId), gt(agentOverrides.expiresAt, new Date())))
    .orderBy(desc(agentOverrides.createdAt));
}
