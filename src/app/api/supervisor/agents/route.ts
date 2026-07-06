import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, leads, assignmentLog } from "@/db/schema";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { and, eq, gte, count, isNull, notInArray, inArray, desc } from "drizzle-orm";
import { resolveDateRange } from "@/lib/analytics/range";
import { WON_DISPOSITION, percentage } from "@/lib/analytics/kpis";
import { TERMINAL_DISPOSITIONS } from "@/lib/assignment";

// Live presence table for the Team dashboard (Part 1). Polled from the
// client every ~10s — kept to a handful of bounded, indexed queries (one
// per agent-list, plus per-agent aggregates scoped to those specific
// agent ids) rather than N+1 per-agent lookups, so this stays fast
// regardless of how many leads a company has accumulated.
export async function GET() {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { from: startOfToday } = resolveDateRange("today");

  const agents = await db
    .select({
      id: users.id,
      name: users.name,
      tier: users.tier,
      presenceStatus: users.presenceStatus,
      lastHeartbeatAt: users.lastHeartbeatAt,
      locked: users.locked,
    })
    .from(users)
    .where(and(eq(users.companyId, session.companyId), eq(users.role, "agent"), eq(users.active, true), isNull(users.deletedAt)));

  if (agents.length === 0) return NextResponse.json({ agents: [] });

  const agentIds = agents.map((a) => a.id);

  const [assignedTodayRows, wonTodayRows, lastLeadRows] = await Promise.all([
    db
      .select({ assignedTo: assignmentLog.assignedTo, value: count() })
      .from(assignmentLog)
      .innerJoin(leads, eq(assignmentLog.leadId, leads.id))
      .where(and(eq(leads.companyId, session.companyId), gte(assignmentLog.assignedAt, startOfToday)))
      .groupBy(assignmentLog.assignedTo),
    db
      .select({ ownerId: leads.ownerId, value: count() })
      .from(leads)
      .where(and(eq(leads.companyId, session.companyId), eq(leads.disposition, WON_DISPOSITION), gte(leads.updatedAt, startOfToday)))
      .groupBy(leads.ownerId),
    // "Last active lead" = most recently touched open lead per agent —
    // scoped to just these agents' ids (not a company-wide scan) and
    // capped, then deduped to first-per-owner in JS since Drizzle has no
    // portable DISTINCT ON helper here.
    db
      .select({ ownerId: leads.ownerId, name: leads.name })
      .from(leads)
      .where(
        and(
          eq(leads.companyId, session.companyId),
          inArray(leads.ownerId, agentIds),
          isNull(leads.deletedAt),
          notInArray(leads.disposition, TERMINAL_DISPOSITIONS)
        )
      )
      .orderBy(desc(leads.updatedAt))
      .limit(500),
  ]);

  const assignedTodayMap = new Map(assignedTodayRows.map((r) => [r.assignedTo, r.value]));
  const wonTodayMap = new Map(wonTodayRows.map((r) => [r.ownerId, r.value]));
  const lastLeadMap = new Map<string, string>();
  for (const row of lastLeadRows) {
    if (row.ownerId && !lastLeadMap.has(row.ownerId)) lastLeadMap.set(row.ownerId, row.name || "Unnamed lead");
  }

  const result = agents.map((a) => {
    const assignedToday = assignedTodayMap.get(a.id) || 0;
    const wonToday = wonTodayMap.get(a.id) || 0;
    return {
      ...a,
      assignedToday,
      wonToday,
      conversionTodayPct: percentage(wonToday, assignedToday),
      lastActiveLeadName: lastLeadMap.get(a.id) || null,
    };
  });

  return NextResponse.json({ agents: result });
}
