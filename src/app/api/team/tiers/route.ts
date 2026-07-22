import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, leads, assignmentLog, automationSettings, tierEnum } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/url";
import { recordAudit } from "@/lib/audit";
import { eventBus } from "@/lib/events/bus";
import { checkPolicy } from "@/lib/rate-limit";
import { deriveDisplayStatus, type PresenceStatus } from "@/lib/presence";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { resolveDateRange } from "@/lib/analytics/range";

// Enterprise Agent Tier Management — the roster behind the "Agent Tier
// Assignments" section on the Automation settings page.
//
// The tier itself is NOT new machinery: users.tier has always been what the
// Assignment Engine's strategies read (see tierOf() in
// src/lib/assignment/strategies/util.ts — the "1" there is only a fallback
// for a null column). This endpoint simply makes that stored value
// administrator-managed. No assignment logic changes.
//
// Access: admins manage, managers view (read-only — viewerCanEdit tells the
// UI which one it is). Agents get a 403: the Agent Portal deliberately never
// exposes other agents' names, workloads or presence to agents, and a tier
// roster is exactly that data.

const ASSIGNABLE_TIERS = tierEnum.enumValues;

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin" && session.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { from: startOfToday } = resolveDateRange("today");

  // Roster, per-company heartbeat timeout (to derive an honest online state),
  // and today's per-agent assignment counts — independent, fired together.
  const [agents, [settingsRow], assignedTodayRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        tier: users.tier,
        presenceStatus: users.presenceStatus,
        lastHeartbeatAt: users.lastHeartbeatAt,
        locked: users.locked,
      })
      .from(users)
      .where(and(eq(users.companyId, session.companyId), eq(users.role, "agent"), eq(users.active, true), isNull(users.deletedAt)))
      .orderBy(users.name),
    db
      .select({ heartbeatTimeoutSeconds: automationSettings.heartbeatTimeoutSeconds })
      .from(automationSettings)
      .where(eq(automationSettings.companyId, session.companyId))
      .limit(1),
    db
      .select({ assignedTo: assignmentLog.assignedTo, value: count() })
      .from(assignmentLog)
      .innerJoin(leads, eq(assignmentLog.leadId, leads.id))
      .where(and(eq(leads.companyId, session.companyId), eq(assignmentLog.status, "assigned"), gte(assignmentLog.assignedAt, startOfToday)))
      .groupBy(assignmentLog.assignedTo),
  ]);

  const heartbeatTimeoutSeconds = settingsRow?.heartbeatTimeoutSeconds ?? 90;
  const assignedTodayMap = new Map(assignedTodayRows.map((r) => [r.assignedTo, r.value]));

  return NextResponse.json({
    viewerCanEdit: session.role === "admin",
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      tier: a.tier ?? "1",
      presenceStatus: deriveDisplayStatus(
        { presenceStatus: a.presenceStatus as PresenceStatus, lastHeartbeatAt: a.lastHeartbeatAt },
        heartbeatTimeoutSeconds
      ),
      assignedToday: assignedTodayMap.get(a.id) || 0,
      // "Auto assign" per agent = not locked. Locking (Team dashboard) is the
      // existing mechanism that excludes an agent from automatic assignment —
      // surfaced here read-only so the roster matches what the engine does.
      autoAssignEnabled: !a.locked,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Managers are read-only on this screen; only admins change tiers.
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can change agent tiers" }, { status: 403 });
  }
  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const agentId = body?.agentId;
  const tier = body?.tier;
  if (typeof agentId !== "string" || !isUuid(agentId)) {
    return NextResponse.json({ error: "agentId must be a valid id" }, { status: 400 });
  }
  if (typeof tier !== "string" || !(ASSIGNABLE_TIERS as readonly string[]).includes(tier)) {
    return NextResponse.json({ error: `tier must be one of: ${ASSIGNABLE_TIERS.join(", ")}` }, { status: 400 });
  }

  // Tenant + role scoping: only an ACTIVE AGENT of this company can be
  // re-tiered; anything else — other tenants' users, admins, deleted
  // accounts — is the same 404 a nonexistent id gets.
  const [agent] = await db
    .select({ id: users.id, name: users.name, tier: users.tier })
    .from(users)
    .where(and(eq(users.id, agentId), eq(users.companyId, session.companyId), eq(users.role, "agent"), isNull(users.deletedAt)))
    .limit(1);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const previousTier = agent.tier ?? "1";
  if (previousTier === tier) {
    // No-op change: nothing to write, nothing to audit.
    return NextResponse.json({ agent: { id: agent.id, tier: previousTier } });
  }

  await db
    .update(users)
    .set({ tier: tier as (typeof ASSIGNABLE_TIERS)[number] })
    .where(and(eq(users.id, agentId), eq(users.companyId, session.companyId)));

  // Audit: who changed whose tier, from what, to what. createdAt is the
  // timestamp.
  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "agent.tier_changed",
    entityType: "user",
    entityId: agentId,
    before: { tier: previousTier },
    after: { tier },
    metadata: { agentName: agent.name },
  });

  // Realtime: every other open admin screen refreshes its roster row (the
  // stream forwards this to admin/manager connections only — see
  // /api/leads/stream). The Assignment Engine needs no signal: it reads
  // users.tier fresh when it loads candidates for each assignment.
  await eventBus.emit("user.updated", { userId: agentId, companyId: session.companyId });

  return NextResponse.json({ agent: { id: agent.id, tier } });
}
