// Enterprise Agent Portal — server-side lead visibility.
//
// The rule, enforced here and nowhere else: an AGENT sees only leads whose
// ownerId is their own userId, AND only their most-recently-assigned N of
// those (the "visibility window"). Admins and managers see the whole company,
// uncapped. Every lead-scoped query condition and every /api/leads/[id]/*
// guard goes through these helpers, so a hand-edited URL or raw API call can
// never reach another agent's lead, an unassigned lead, another tenant's
// data, OR one of the agent's own leads that has aged out of the window —
// the WHERE clause simply excludes them, and the caller returns the same
// 404 a nonexistent lead produces (no existence oracle).
//
// The window is a hard DB-level LIMIT (never "load all rows and hide the
// extras in the UI"): the agent's N newest-assigned live leads, ordered by
// assignedAt (then createdAt, then id as a stable tiebreaker). N is the
// platform-wide cap the owner sets in Platform Settings (default 400). Older
// leads are hidden from the agent but NOT deleted — history stays intact for
// admins and managers.
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { getAgentLeadVisibilityCap } from "@/lib/platform/settings";
import { recordSecurityEvent } from "@/lib/security/events";

export type LeadSessionScope = { userId: string; companyId: string; role: string };

// The visibility conditions for list queries: tenant always, plus ownership +
// the latest-N window for agents. Callers add their own filters (search,
// disposition, deletedAt…) — every one ANDs onto these, so a filter can only
// ever NARROW what the caller may see, never widen it. Async because the
// agent cap is a (cached) Platform Setting.
export async function leadVisibilityConditions(session: LeadSessionScope): Promise<SQL[]> {
  const conditions: SQL[] = [eq(leads.companyId, session.companyId)];
  if (session.role === "agent") {
    conditions.push(eq(leads.ownerId, session.userId));
    // Latest-N assigned-lead window, enforced at the database. The subquery
    // picks the agent's N newest-assigned LIVE leads and the outer query is
    // constrained to that id set. Uncorrelated + aliased ("w") so there is no
    // ambiguity with the outer `leads`; the (company_id, owner_id) index makes
    // fetching the agent's own set cheap, and the LIMIT bounds the sort.
    const cap = await getAgentLeadVisibilityCap();
    conditions.push(
      sql`${leads.id} in (
        select w.id from ${leads} as w
        where w.company_id = ${session.companyId}
          and w.owner_id = ${session.userId}
          and w.deleted_at is null
        order by w.assigned_at desc nulls last, w.created_at desc, w.id desc
        limit ${cap}
      )`
    );
  }
  return conditions;
}

// The shared per-lead guard for /api/leads/[id]/* sub-routes. Replaces the
// previous inline `select id where id + companyId` checks — identical for
// admin/manager, additionally ownership- AND window-scoped for agents.
//
// On the deny path we distinguish, for agents only, "your own lead but
// outside your visibility window" from an ordinary not-found, and audit the
// former as a security event — the signal the spec asks for when an agent
// reaches for a lead beyond their permitted history. Other-agent / other-
// tenant / nonexistent ids are NOT audited (that would be an existence
// oracle and pure noise); they just 404 like before.
export async function canAccessLead(session: LeadSessionScope, leadId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), ...(await leadVisibilityConditions(session))))
    .limit(1);
  if (row) return true;

  if (session.role === "agent") {
    // Is this actually one of the agent's own LIVE leads that simply aged out
    // of the window? Only then is it a "reaching past your history" event.
    const [owned] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.id, leadId),
          eq(leads.companyId, session.companyId),
          eq(leads.ownerId, session.userId),
          sql`${leads.deletedAt} is null`
        )
      )
      .limit(1);
    if (owned) {
      await recordSecurityEvent({
        event: "lead.access_denied",
        riskLevel: "medium",
        companyId: session.companyId,
        userId: session.userId,
        reason: "outside_visibility_window",
        metadata: { leadId },
      });
    }
  }
  return false;
}
