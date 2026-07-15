// Operations Center — the point-in-time operational snapshot for one company.
// Reuses the existing per-company aggregates (presence getCompanySnapshot,
// lifecycle getQueueHealth) and adds a handful of small, indexed, company-
// scoped counts. The whole thing is cached for 5s, so however many admins are
// watching (and however often the SSE tick fires), the DB is hit at most once
// per company per 5s — "no unnecessary database queries".
import { db } from "@/db";
import { assignmentHistory, assignmentJobs, leadLifecycleEvents, leads, users, webhookLogs } from "@/db/schema";
import { and, eq, gte, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { presenceService } from "@/lib/presence/service";
import { getQueueHealth } from "@/lib/lifecycle/health";
import { TERMINAL_DISPOSITIONS } from "@/lib/assignment/constants";
import { deriveWarnings, type OpsWarning } from "./warnings";
import type { PresenceState } from "@/lib/presence/state";

export type SystemStatus = "Healthy" | "Busy" | "High Load" | "Critical";

export interface OpsAgent {
  userId: string;
  name: string;
  state: PresenceState;
  activeLeads: number;
  assignmentsToday: number;
  idleSeconds: number | null;
  capacity: number | null; // per-agent max active leads, if configured
  lastHeartbeatAt: string | null;
}

export interface OpsSnapshot {
  at: string;
  liveStatus: { online: number; busy: number; away: number; offline: number; locked: number; unknown: number; total: number };
  queue: { size: number; oldestWaitSeconds: number | null; avgWaitSeconds: number | null; avgAssignmentTimeMs: number | null; status: SystemStatus };
  today: { leadsReceived: number; assignments: number; recycled: number; closed: number; openLeads: number; avgResponseSeconds: number | null; avgQueueSeconds: number | null };
  agents: OpsAgent[];
  warnings: OpsWarning[];
}

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Auto-classified queue health — no manual configuration, just sensible fixed
// thresholds over depth + oldest-wait + failures.
function classifyQueueHealth(queueSize: number, oldestWaitSeconds: number | null, deadLetter: number): SystemStatus {
  if (queueSize >= 200 || (oldestWaitSeconds ?? 0) >= 30 * 60 || deadLetter >= 20) return "Critical";
  if (queueSize >= 50 || (oldestWaitSeconds ?? 0) >= 10 * 60 || deadLetter > 0) return "High Load";
  if (queueSize >= 15 || (oldestWaitSeconds ?? 0) >= 2 * 60) return "Busy";
  return "Healthy";
}

export async function getOperationsSnapshot(companyId: string): Promise<OpsSnapshot> {
  return cache.getOrSet(`ops-snapshot:${companyId}`, 5_000, () => computeSnapshot(companyId));
}

async function computeSnapshot(companyId: string): Promise<OpsSnapshot> {
  const sod = startOfDay();
  const termSql = sql.join(TERMINAL_DISPOSITIONS.map((t) => sql`${t}`), sql`, `);

  const [presence, queueHealth, roster, activeByAgent, todayByAgent, todayLeads, openRow, lifeAgg, overdue, deliveryFails, failedJobsRow] = await Promise.all([
    presenceService.getCompanySnapshot(companyId),
    getQueueHealth(companyId),
    db.select({ id: users.id, name: users.name, lastAssignedAt: users.lastAssignedAt, routingConfig: users.routingConfig }).from(users).where(and(eq(users.companyId, companyId), eq(users.role, "agent"), eq(users.active, true), isNull(users.deletedAt))),
    db.select({ ownerId: leads.ownerId, n: sql<number>`count(*)::int` }).from(leads).where(and(eq(leads.companyId, companyId), isNotNull(leads.ownerId), isNull(leads.deletedAt), notInArray(leads.disposition, TERMINAL_DISPOSITIONS))).groupBy(leads.ownerId),
    db.select({ agent: assignmentHistory.assignedTo, n: sql<number>`count(*)::int` }).from(assignmentHistory).where(and(eq(assignmentHistory.companyId, companyId), eq(assignmentHistory.outcome, "assigned"), gte(assignmentHistory.createdAt, sod))).groupBy(assignmentHistory.assignedTo),
    // Today's leads received + avg time-to-assign (response) over them. `gte` in
    // the WHERE is the reliable date filter used throughout; the avg's FILTER is
    // on a non-date condition only.
    db.select({
      leadsToday: sql<number>`count(*)::int`,
      avgResp: sql<string | null>`avg(extract(epoch from (${leads.assignedAt} - ${leads.createdAt}))) FILTER (WHERE ${leads.assignedAt} IS NOT NULL)`,
    }).from(leads).where(and(eq(leads.companyId, companyId), gte(leads.createdAt, sod))),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(eq(leads.companyId, companyId), isNull(leads.deletedAt), notInArray(leads.disposition, TERMINAL_DISPOSITIONS))),
    db.select({
      recycled: sql<number>`count(*) FILTER (WHERE ${leadLifecycleEvents.reason} LIKE 'recycled%')::int`,
      closed: sql<number>`count(*) FILTER (WHERE ${leadLifecycleEvents.toStage} IN ('won','lost','closed'))::int`,
    }).from(leadLifecycleEvents).where(and(eq(leadLifecycleEvents.companyId, companyId), gte(leadLifecycleEvents.createdAt, sod))),
    db.select({ n: sql<number>`count(*)::int` }).from(assignmentJobs).where(and(eq(assignmentJobs.companyId, companyId), isNotNull(assignmentJobs.slaDeadline), lt(assignmentJobs.slaDeadline, new Date()), sql`${assignmentJobs.status} IN ('pending','failed')`)),
    db.select({ n: sql<number>`count(*)::int` }).from(webhookLogs).where(and(eq(webhookLogs.companyId, companyId), eq(webhookLogs.status, "failed"), gte(webhookLogs.createdAt, sod))),
    db.select({ n: sql<number>`count(*)::int` }).from(assignmentJobs).where(and(eq(assignmentJobs.companyId, companyId), eq(assignmentJobs.status, "failed"))),
  ]);

  const stateByUser = new Map<string, { state: PresenceState; lastHeartbeatAt: Date | null }>();
  for (const p of presence) stateByUser.set(p.userId, { state: p.state, lastHeartbeatAt: p.lastHeartbeatAt });
  const activeMap = new Map(activeByAgent.filter((r) => r.ownerId).map((r) => [r.ownerId as string, Number(r.n)]));
  const todayMap = new Map(todayByAgent.filter((r) => r.agent).map((r) => [r.agent as string, Number(r.n)]));

  const now = Date.now();
  const agents: OpsAgent[] = roster.map((u) => {
    const pres = stateByUser.get(u.id);
    const state: PresenceState = pres?.state ?? "OFFLINE";
    const cap = (u.routingConfig as { capacity?: { maxActiveLeads?: number | null } } | null)?.capacity?.maxActiveLeads ?? null;
    return {
      userId: u.id,
      name: u.name,
      state,
      activeLeads: activeMap.get(u.id) ?? 0,
      assignmentsToday: todayMap.get(u.id) ?? 0,
      idleSeconds: u.lastAssignedAt ? Math.round((now - u.lastAssignedAt.getTime()) / 1000) : null,
      capacity: cap,
      lastHeartbeatAt: pres?.lastHeartbeatAt ? pres.lastHeartbeatAt.toISOString() : null,
    };
  });

  const live = { online: 0, busy: 0, away: 0, offline: 0, locked: 0, unknown: 0, total: agents.length };
  for (const a of agents) {
    if (a.state === "ONLINE") live.online++;
    else if (a.state === "BUSY") live.busy++;
    else if (a.state === "AWAY") live.away++;
    else if (a.state === "LOCKED") live.locked++;
    else if (a.state === "UNKNOWN") live.unknown++;
    else live.offline++; // OFFLINE / LOGGED_OUT
  }

  const queueSize = queueHealth.queueDepth;
  const oldestWait = queueHealth.oldestQueuedAgeSeconds;
  const status = classifyQueueHealth(queueSize, oldestWait, queueHealth.deadLetterCount);

  const warnings = deriveWarnings({
    onlineOrBusyAgents: live.online + live.busy,
    totalAgents: live.total,
    queueSize,
    oldestWaitSeconds: oldestWait,
    deadLetterCount: queueHealth.deadLetterCount,
    overdueSlaCount: Number(overdue[0]?.n ?? 0),
    deliveryFailuresToday: Number(deliveryFails[0]?.n ?? 0),
    failedJobs: Number(failedJobsRow[0]?.n ?? 0),
  });

  const assignmentsToday = [...todayMap.values()].reduce((a, b) => a + b, 0);

  return {
    at: new Date().toISOString(),
    liveStatus: live,
    queue: { size: queueSize, oldestWaitSeconds: oldestWait, avgWaitSeconds: queueHealth.avgQueuedWaitSeconds, avgAssignmentTimeMs: queueHealth.avgAssignmentLatencyMs, status },
    today: {
      leadsReceived: Number(todayLeads[0]?.leadsToday ?? 0),
      assignments: assignmentsToday,
      recycled: Number(lifeAgg[0]?.recycled ?? 0),
      closed: Number(lifeAgg[0]?.closed ?? 0),
      openLeads: Number(openRow[0]?.n ?? 0),
      avgResponseSeconds: todayLeads[0]?.avgResp != null ? Math.round(Number(todayLeads[0].avgResp)) : null,
      avgQueueSeconds: queueHealth.avgQueuedWaitSeconds,
    },
    agents: agents.sort((a, b) => b.assignmentsToday - a.assignmentsToday || a.name.localeCompare(b.name)),
    warnings,
  };
}
