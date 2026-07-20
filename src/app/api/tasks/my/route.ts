import { NextResponse } from "next/server";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { checkPolicy } from "@/lib/rate-limit";
import { listCallbacks } from "@/lib/callbacks";
import { TERMINAL_DISPOSITIONS } from "@/lib/dispositions/taxonomy";
import { and, desc, eq, isNull, lte, notInArray, or, sql } from "drizzle-orm";

// My Tasks (Follow-up & Pipeline Part 4) — everything the signed-in user
// should act on today, in one response:
//   • today's callbacks          • overdue callbacks
//   • newly assigned leads       • high-priority follow-ups
//
// ALWAYS personal: even a supervisor's "My Tasks" is their own queue (the
// company-wide view is the admin pipeline overview). Agents are additionally
// scoped inside the callback service itself. Four bounded, indexed queries —
// callbacks ride callbacks_agent_status_idx, leads ride
// leads_company_owner_idx — so this stays flat however many leads exist.
export async function GET() {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const myOpenLeads = [
    eq(leads.companyId, session.companyId),
    eq(leads.ownerId, session.userId),
    isNull(leads.deletedAt),
    notInArray(leads.disposition, TERMINAL_DISPOSITIONS),
  ];
  const soon = new Date(Date.now() + 24 * 3_600_000);

  const [todayCallbacks, overdueCallbacks, newLeads, highPriority] = await Promise.all([
    listCallbacks(session, { tab: "today", agentId: session.userId, limit: 25 }),
    listCallbacks(session, { tab: "overdue", agentId: session.userId, limit: 25 }),
    db
      .select({ id: leads.id, name: leads.name, phone: leads.phone, disposition: leads.disposition, createdAt: leads.createdAt, assignedAt: leads.assignedAt })
      .from(leads)
      .where(and(...myOpenLeads, eq(leads.disposition, "New Lead")))
      .orderBy(desc(sql`coalesce(${leads.assignedAt}, ${leads.createdAt})`))
      .limit(25),
    db
      .select({ id: leads.id, name: leads.name, phone: leads.phone, disposition: leads.disposition, priority: leads.priority, followUpAt: leads.followUpAt, updatedAt: leads.updatedAt })
      .from(leads)
      .where(
        and(
          ...myOpenLeads,
          // "High priority follow-up" = the lead is flagged high priority, or
          // its follow-up moment is already inside the next 24 hours.
          or(eq(leads.priority, "high"), and(sql`${leads.followUpAt} is not null`, lte(leads.followUpAt, soon)))
        )
      )
      .orderBy(sql`${leads.followUpAt} asc nulls last`)
      .limit(25),
  ]);

  return NextResponse.json({ todayCallbacks, overdueCallbacks, newLeads, highPriority });
}
