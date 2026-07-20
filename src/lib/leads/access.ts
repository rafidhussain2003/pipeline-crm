// Enterprise Agent Portal — server-side lead visibility.
//
// The rule, enforced here and nowhere else: an AGENT sees only leads whose
// ownerId is their own userId. Admins and managers see the whole company.
// Every lead-scoped query condition and every /api/leads/[id]/* guard goes
// through these helpers, so a hand-edited URL or raw API call can never
// reach another agent's lead, an unassigned lead, or another tenant's data —
// the WHERE clause simply excludes them, and the caller returns the same
// 404 a nonexistent lead produces (no existence oracle).
import { and, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";

export type LeadSessionScope = { userId: string; companyId: string; role: string };

// The visibility conditions for list queries: tenant always, ownership for
// agents. Callers add their own filters (search, disposition, deletedAt…).
export function leadVisibilityConditions(session: LeadSessionScope): SQL[] {
  const conditions: SQL[] = [eq(leads.companyId, session.companyId)];
  if (session.role === "agent") conditions.push(eq(leads.ownerId, session.userId));
  return conditions;
}

// The shared per-lead guard for /api/leads/[id]/* sub-routes. Replaces the
// previous inline `select id where id + companyId` checks — identical for
// admin/manager, additionally ownership-scoped for agents.
export async function canAccessLead(session: LeadSessionScope, leadId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), ...leadVisibilityConditions(session)))
    .limit(1);
  return !!row;
}
