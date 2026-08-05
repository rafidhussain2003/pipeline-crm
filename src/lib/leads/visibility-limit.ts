// Agent lead-visibility limit — how many of their most-recently-assigned
// leads an agent may see in the CRM. A PER-COMPANY setting the company admin
// controls (Profile > Company). Stored on companies.agentLeadVisibilityLimit
// (NULL = use the default here). Admins and managers are never capped — this
// value only bounds the agent branch of leadVisibilityConditions.
//
// The read is cached (short TTL) and schema-lag safe: if the column hasn't
// been added yet (migration 0052 not applied on this instance), it returns
// the default instead of throwing — the same pattern getManagerPrivacyMode
// uses. Writes go through the company-settings PATCH route, which invalidates
// this cache key.
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { isUndefinedColumn } from "@/lib/db-errors";

export const DEFAULT_AGENT_LEAD_CAP = 400;
// Guardrails on what an admin can set: never so low it blinds agents, never so
// high it defeats the purpose / hurts query planning.
export const MIN_AGENT_LEAD_CAP = 50;
export const MAX_AGENT_LEAD_CAP = 100_000;

export const agentLeadCapCacheKey = (companyId: string) => `agent-lead-cap:${companyId}`;

export function clampAgentLeadCap(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_AGENT_LEAD_CAP;
  return Math.min(MAX_AGENT_LEAD_CAP, Math.max(MIN_AGENT_LEAD_CAP, Math.floor(n)));
}

// The effective cap for a company: its configured value (clamped), or the
// built-in default when unset / column missing.
export async function getAgentLeadVisibilityCap(companyId: string): Promise<number> {
  return cache.getOrSet(agentLeadCapCacheKey(companyId), 30_000, async () => {
    try {
      const [row] = await db
        .select({ v: companies.agentLeadVisibilityLimit })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      const v = row?.v ?? null;
      return v === null ? DEFAULT_AGENT_LEAD_CAP : clampAgentLeadCap(v);
    } catch (err) {
      if (isUndefinedColumn(err)) return DEFAULT_AGENT_LEAD_CAP;
      throw err;
    }
  });
}
