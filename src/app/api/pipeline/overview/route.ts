import { NextResponse } from "next/server";
import { db } from "@/db";
import { callbacks, leads, users } from "@/db/schema";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { TERMINAL_DISPOSITIONS, WON_DISPOSITIONS } from "@/lib/dispositions/taxonomy";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";

// Admin pipeline overview (Follow-up & Pipeline Part 5):
//   • leads requiring callbacks    • overdue follow-ups
//   • agents with highest backlog  • sales closed today
//
// Supervisor-only. Aggregates and short lists, never full tables — every
// query is a bounded count/group ride on an existing index
// (callbacks_company_scheduled_idx, callbacks_status_scheduled_idx,
// leads_company_owner_idx), so a company with thousands of leads answers in
// a handful of index scans.
export async function GET() {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const openCallback = inArray(callbacks.status, ["scheduled", "due", "missed"]);
  const openLead = [eq(leads.companyId, session.companyId), isNull(leads.deletedAt), notInArray(leads.disposition, TERMINAL_DISPOSITIONS)];

  const [
    [callbackTotals],
    overdueCallbackRows,
    [overdueFollowUps],
    backlogRows,
    [salesToday],
  ] = await Promise.all([
    // Leads requiring callbacks: distinct leads with an open callback, plus
    // how many of those callbacks are already overdue.
    db
      .select({
        leadsRequiringCallbacks: sql<number>`count(distinct ${callbacks.leadId})::int`,
        overdueCallbacks: sql<number>`count(*) filter (where ${callbacks.scheduledAt} < ${now})::int`,
      })
      .from(callbacks)
      .where(and(eq(callbacks.companyId, session.companyId), openCallback)),
    // The most overdue open callbacks, for the "act on these first" list.
    db
      .select({
        id: callbacks.id,
        leadId: callbacks.leadId,
        leadName: leads.name,
        agentName: users.name,
        scheduledAt: callbacks.scheduledAt,
        priority: callbacks.priority,
        reason: callbacks.reason,
      })
      .from(callbacks)
      .leftJoin(leads, eq(callbacks.leadId, leads.id))
      .leftJoin(users, eq(callbacks.agentId, users.id))
      .where(and(eq(callbacks.companyId, session.companyId), openCallback, lt(callbacks.scheduledAt, now)))
      .orderBy(callbacks.scheduledAt)
      .limit(10),
    // Overdue follow-ups outside the callback system: open leads whose
    // follow-up moment has passed.
    db
      .select({ value: count() })
      .from(leads)
      .where(and(...openLead, isNotNull(leads.followUpAt), lt(leads.followUpAt, now))),
    // Highest backlog: open leads per agent, worst first.
    db
      .select({ ownerId: leads.ownerId, ownerName: users.name, openLeads: count() })
      .from(leads)
      .innerJoin(users, eq(leads.ownerId, users.id))
      .where(and(...openLead, isNotNull(leads.ownerId)))
      .groupBy(leads.ownerId, users.name)
      .orderBy(desc(count()))
      .limit(5),
    // Sales closed today: leads currently in a won disposition whose last
    // change happened today — same definition the Team dashboard uses.
    db
      .select({ value: count() })
      .from(leads)
      .where(and(eq(leads.companyId, session.companyId), isNull(leads.deletedAt), inArray(leads.disposition, WON_DISPOSITIONS), gte(leads.updatedAt, startOfToday))),
  ]);

  return NextResponse.json({
    leadsRequiringCallbacks: callbackTotals?.leadsRequiringCallbacks ?? 0,
    overdueCallbacks: callbackTotals?.overdueCallbacks ?? 0,
    overdueCallbackList: overdueCallbackRows,
    overdueFollowUps: overdueFollowUps?.value ?? 0,
    backlog: backlogRows,
    salesClosedToday: salesToday?.value ?? 0,
  });
}
