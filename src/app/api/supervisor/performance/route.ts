import { NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users, assignmentLog } from "@/db/schema";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { and, eq, gte, count, desc, inArray, isNull, gt } from "drizzle-orm";
import { resolveDateRange } from "@/lib/analytics/range";
import { WON_DISPOSITIONS } from "@/lib/analytics/kpis";

// Team performance leaderboard (Part 5) + recent routing decisions (Part 3
// "view routing decisions") — built entirely on assignment_log and leads,
// the same tables the assignment engine already writes, so there's no new
// tracking to add for this view.
export async function GET() {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { from: startOfToday } = resolveDateRange("today");

  const [topCloserRows, mostActiveRows, mostRecycled, recentDecisions] = await Promise.all([
    db
      .select({ ownerId: leads.ownerId, ownerName: users.name, value: count() })
      .from(leads)
      .leftJoin(users, eq(leads.ownerId, users.id))
      .where(and(eq(leads.companyId, session.companyId), inArray(leads.disposition, WON_DISPOSITIONS), gte(leads.updatedAt, startOfToday)))
      .groupBy(leads.ownerId, users.name)
      .orderBy(desc(count()))
      .limit(1),
    db
      .select({ assignedTo: assignmentLog.assignedTo, ownerName: users.name, value: count() })
      .from(assignmentLog)
      .innerJoin(leads, eq(assignmentLog.leadId, leads.id))
      .leftJoin(users, eq(assignmentLog.assignedTo, users.id))
      // status='assigned' is required, not optional: assignment_log records
      // EVERY decision, including 'failed' (no eligible agent) and 'skipped'
      // (lost claim race), and those rows carry assigned_to = NULL. Without
      // this filter they group into a single NULL bucket that can out-count
      // every real agent — so "most active agent today" would report a blank
      // agent with an inflated number.
      .where(and(eq(leads.companyId, session.companyId), eq(assignmentLog.status, "assigned"), gte(assignmentLog.assignedAt, startOfToday)))
      .groupBy(assignmentLog.assignedTo, users.name)
      .orderBy(desc(count()))
      .limit(1),
    db
      .select({ id: leads.id, name: leads.name, recycleCount: leads.recycleCount, ownerName: users.name })
      .from(leads)
      .leftJoin(users, eq(leads.ownerId, users.id))
      .where(and(eq(leads.companyId, session.companyId), isNull(leads.deletedAt), gt(leads.recycleCount, 0)))
      .orderBy(desc(leads.recycleCount))
      .limit(5),
    db
      .select({
        id: assignmentLog.id,
        leadName: leads.name,
        agentName: users.name,
        ruleUsed: assignmentLog.ruleUsed,
        assignedAt: assignmentLog.assignedAt,
      })
      .from(assignmentLog)
      .innerJoin(leads, eq(assignmentLog.leadId, leads.id))
      .leftJoin(users, eq(assignmentLog.assignedTo, users.id))
      // Likewise: a "recent assignments" feed must list assignments, not
      // failed or skipped attempts (which would render with a blank agent).
      .where(and(eq(leads.companyId, session.companyId), eq(assignmentLog.status, "assigned")))
      .orderBy(desc(assignmentLog.assignedAt))
      .limit(20),
  ]);

  return NextResponse.json({
    topCloserToday: topCloserRows[0] || null,
    mostActiveToday: mostActiveRows[0] || null,
    mostRecycled,
    recentDecisions,
  });
}
