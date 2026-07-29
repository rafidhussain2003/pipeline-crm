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
  // Admin + manager view; the Lead Distribution Manager also views (and edits,
  // below) tiers — assigning agents to tiers is part of distributing leads.
  if (session.role !== "admin" && session.role !== "manager" && session.role !== "lead_distributor") {
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
    viewerCanEdit: session.role === "admin" || session.role === "lead_distributor",
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
  // Admins and the Lead Distribution Manager may change tiers (both are
  // responsible for how leads route to agents); managers stay read-only here.
  if (session.role !== "admin" && session.role !== "lead_distributor") {
    return NextResponse.json({ error: "You can't change agent tiers" }, { status: 403 });
  }
  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  // Accepts a tier change and/or an auto-assign participation toggle. The
  // toggle writes users.locked (locked = excluded from the assignment roster;
  // see presence/service.ts) — enabled ⇒ locked=false, disabled ⇒ locked=true.
  const body = await req.json().catch(() => null);
  const agentId = body?.agentId;
  if (typeof agentId !== "string" || !isUuid(agentId)) {
    return NextResponse.json({ error: "agentId must be a valid id" }, { status: 400 });
  }
  const hasTier = body?.tier !== undefined;
  const hasToggle = typeof body?.autoAssignEnabled === "boolean";
  if (!hasTier && !hasToggle) {
    return NextResponse.json({ error: "Provide tier and/or autoAssignEnabled." }, { status: 400 });
  }
  if (hasTier && (typeof body.tier !== "string" || !(ASSIGNABLE_TIERS as readonly string[]).includes(body.tier))) {
    return NextResponse.json({ error: `tier must be one of: ${ASSIGNABLE_TIERS.join(", ")}` }, { status: 400 });
  }

  // Tenant + role scoping: only an ACTIVE AGENT of this company — anything else
  // (other tenants' users, admins, deleted accounts) is the same 404 a
  // nonexistent id gets.
  const [agent] = await db
    .select({ id: users.id, name: users.name, tier: users.tier, locked: users.locked })
    .from(users)
    .where(and(eq(users.id, agentId), eq(users.companyId, session.companyId), eq(users.role, "agent"), isNull(users.deletedAt)))
    .limit(1);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const previousTier = agent.tier ?? "1";
  const set: { tier?: (typeof ASSIGNABLE_TIERS)[number]; locked?: boolean } = {};
  if (hasTier && previousTier !== body.tier) set.tier = body.tier;
  if (hasToggle && agent.locked !== !body.autoAssignEnabled) set.locked = !body.autoAssignEnabled;

  if (Object.keys(set).length === 0) {
    // No-op — nothing actually changed.
    return NextResponse.json({ agent: { id: agent.id, tier: previousTier, autoAssignEnabled: !agent.locked } });
  }

  await db.update(users).set(set).where(and(eq(users.id, agentId), eq(users.companyId, session.companyId)));

  if (set.tier !== undefined) {
    await recordAudit({
      companyId: session.companyId, userId: session.userId, action: "agent.tier_changed",
      entityType: "user", entityId: agentId, before: { tier: previousTier }, after: { tier: set.tier },
      metadata: { agentName: agent.name },
    });
  }
  if (set.locked !== undefined) {
    await recordAudit({
      companyId: session.companyId, userId: session.userId, action: "agent.auto_assign_participation_changed",
      entityType: "user", entityId: agentId, before: { autoAssignEnabled: !agent.locked }, after: { autoAssignEnabled: !set.locked },
      metadata: { agentName: agent.name },
    });
  }

  // Realtime: open roster screens refresh (admin/manager/distributor). The
  // Assignment Engine needs no signal — it reads tier + locked fresh per
  // assignment.
  await eventBus.emit("user.updated", { userId: agentId, companyId: session.companyId });

  return NextResponse.json({
    agent: { id: agent.id, tier: set.tier ?? previousTier, autoAssignEnabled: !(set.locked ?? agent.locked) },
  });
}
