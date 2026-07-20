// Phase 15 — the callback service: every state transition a callback can make,
// in one place, each one audited and each one recorded to the callback's own
// history. Routes stay thin; the reminder worker never calls back into here.
//
// Scheduling a callback NEVER blocks on the reminder engine: rows are written,
// the worker is kicked fire-and-forget, and the response returns.
import { db } from "@/db";
import { callbacks, leadInsights, leads, users } from "@/db/schema";
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { eventBus } from "@/lib/events/bus";
import { hasPermission } from "@/lib/permissions";
import type { SessionPayload } from "@/lib/auth";
import { getCallbackSettings } from "./config";
import { computePriorityScore } from "./prioritize";
import { cancelRemindersFor, kickCallbackWorker, scheduleRemindersFor } from "./reminders";
import { recordCallbackEvent } from "./history";
import { CALLBACK_PRIORITIES, CALLBACK_REASONS, type CallbackPriority } from "./types";

export class CallbackError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// ── Access control ──────────────────────────────────────────────────────────
// A callback is visible/actionable to the agent it belongs to, and to whoever
// supervises callbacks (manager/admin — see permissions.ts for why that's its
// own permission and not leads:supervise). Tenant isolation is enforced on
// every query by companyId — never by trusting an id from the client.
function canAct(session: SessionPayload, agentId: string): boolean {
  return session.userId === agentId || hasPermission(session.role, "callbacks:supervise");
}

async function loadCallback(id: string, companyId: string) {
  const [row] = await db.select().from(callbacks).where(and(eq(callbacks.id, id), eq(callbacks.companyId, companyId))).limit(1);
  return row ?? null;
}

async function requireActable(session: SessionPayload, id: string) {
  const row = await loadCallback(id, session.companyId!);
  if (!row) throw new CallbackError("Callback not found", 404);
  if (!canAct(session, row.agentId)) throw new CallbackError("You do not have access to this callback", 403);
  return row;
}

// Signals for the priority score, fetched with the lead in one indexed read.
async function scoreFor(leadId: string, scheduledAt: Date, priority: string): Promise<number> {
  const [row] = await db
    .select({ createdAt: leads.createdAt, disposition: leads.disposition, isDuplicate: leads.isDuplicate, score: leadInsights.score })
    .from(leads)
    .leftJoin(leadInsights, eq(leadInsights.leadId, leads.id))
    .where(eq(leads.id, leadId))
    .limit(1);
  return computePriorityScore({
    scheduledAt,
    priority,
    leadScore: row?.score ?? null,
    leadCreatedAt: row?.createdAt ?? null,
    disposition: row?.disposition ?? null,
    isDuplicate: row?.isDuplicate ?? null,
  });
}

function validate(input: { scheduledAt: Date; reason: string; priority: string }) {
  if (Number.isNaN(input.scheduledAt.getTime())) throw new CallbackError("A valid callback date and time is required");
  if (input.scheduledAt.getTime() < Date.now() - 60_000) throw new CallbackError("Callback time must be in the future");
  if (!CALLBACK_REASONS.includes(input.reason as (typeof CALLBACK_REASONS)[number])) throw new CallbackError("Invalid callback reason");
  if (!CALLBACK_PRIORITIES.includes(input.priority as CallbackPriority)) throw new CallbackError("Invalid priority");
}

// ── Schedule ────────────────────────────────────────────────────────────────
export interface ScheduleInput {
  leadId: string;
  scheduledAt: Date;
  timezone?: string;
  reason: string;
  notes?: string | null;
  priority?: string;
  agentId?: string; // managers/admins may schedule on another agent's behalf
}

export async function scheduleCallback(session: SessionPayload, input: ScheduleInput) {
  const companyId = session.companyId!;
  const priority = input.priority || "normal";
  validate({ scheduledAt: input.scheduledAt, reason: input.reason, priority });

  // The lead must exist in THIS company — this is the tenant boundary.
  const [lead] = await db.select({ id: leads.id, ownerId: leads.ownerId, name: leads.name }).from(leads).where(and(eq(leads.id, input.leadId), eq(leads.companyId, companyId))).limit(1);
  if (!lead) throw new CallbackError("Lead not found", 404);

  // Default to the lead's assigned agent; fall back to the scheduler.
  const agentId = input.agentId || lead.ownerId || session.userId;
  if (!canAct(session, agentId)) throw new CallbackError("You cannot schedule a callback for another agent", 403);

  const priorityScore = await scoreFor(lead.id, input.scheduledAt, priority);
  const [row] = await db
    .insert(callbacks)
    .values({
      companyId, leadId: lead.id, agentId, createdBy: session.userId,
      scheduledAt: input.scheduledAt, timezone: input.timezone || "UTC",
      reason: input.reason, notes: input.notes || null, priority, priorityScore, status: "scheduled",
    })
    .returning();

  const settings = await getCallbackSettings(companyId);
  await scheduleRemindersFor({ id: row.id, companyId, agentId, scheduledAt: row.scheduledAt }, settings);
  kickCallbackWorker(); // fire-and-forget — the response does not wait

  await recordCallbackEvent({ callbackId: row.id, companyId, type: "created", actorUserId: session.userId, metadata: { scheduledAt: row.scheduledAt.toISOString(), reason: row.reason, priority } });
  await recordAudit({ companyId, userId: session.userId, action: "callback.scheduled", entityType: "callback", entityId: row.id, after: { leadId: lead.id, agentId, scheduledAt: row.scheduledAt, reason: row.reason, priority } });
  // Lead Workspace realtime: anyone with this lead open sees the new
  // callback without refreshing (forwarded to the SSE stream by the hub).
  await eventBus.emit("lead.updated", { leadId: lead.id, companyId, changedFields: ["callbacks"] });
  return row;
}

// ── Reschedule ──────────────────────────────────────────────────────────────
// The old callback is kept (status "rescheduled") and the new one points back
// at it via rescheduledFromId, so the chain is fully reconstructable.
export async function rescheduleCallback(session: SessionPayload, id: string, input: { scheduledAt: Date; reason?: string; notes?: string | null; priority?: string; timezone?: string }) {
  const companyId = session.companyId!;
  const old = await requireActable(session, id);
  if (old.status === "completed" || old.status === "cancelled" || old.status === "rescheduled") {
    throw new CallbackError(`A ${old.status} callback cannot be rescheduled`);
  }
  const reason = input.reason || old.reason;
  const priority = input.priority || old.priority;
  validate({ scheduledAt: input.scheduledAt, reason, priority });

  await cancelRemindersFor(old.id);
  await db.update(callbacks).set({ status: "rescheduled", updatedAt: new Date() }).where(eq(callbacks.id, old.id));

  const priorityScore = await scoreFor(old.leadId, input.scheduledAt, priority);
  const [row] = await db
    .insert(callbacks)
    .values({
      companyId, leadId: old.leadId, agentId: old.agentId, createdBy: session.userId,
      scheduledAt: input.scheduledAt, timezone: input.timezone || old.timezone,
      reason, notes: input.notes !== undefined ? input.notes : old.notes, priority, priorityScore,
      status: "scheduled", rescheduledFromId: old.id, rescheduleCount: old.rescheduleCount + 1,
    })
    .returning();

  await scheduleRemindersFor({ id: row.id, companyId, agentId: row.agentId, scheduledAt: row.scheduledAt });
  kickCallbackWorker();

  await recordCallbackEvent({ callbackId: old.id, companyId, type: "rescheduled", actorUserId: session.userId, metadata: { to: row.id, from: old.scheduledAt.toISOString(), toTime: row.scheduledAt.toISOString() } });
  await recordCallbackEvent({ callbackId: row.id, companyId, type: "created", actorUserId: session.userId, metadata: { rescheduledFrom: old.id, attempt: row.rescheduleCount + 1 } });
  await recordAudit({ companyId, userId: session.userId, action: "callback.rescheduled", entityType: "callback", entityId: row.id, before: { id: old.id, scheduledAt: old.scheduledAt }, after: { id: row.id, scheduledAt: row.scheduledAt, reason, priority } });
  await eventBus.emit("lead.updated", { leadId: old.leadId, companyId, changedFields: ["callbacks"] });
  return row;
}

// ── Cancel / Complete / Acknowledge ─────────────────────────────────────────
export async function cancelCallback(session: SessionPayload, id: string, note?: string) {
  const companyId = session.companyId!;
  const old = await requireActable(session, id);
  if (old.status === "completed" || old.status === "cancelled") throw new CallbackError(`Callback is already ${old.status}`);

  await cancelRemindersFor(old.id);
  const [row] = await db.update(callbacks).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(callbacks.id, old.id)).returning();

  await recordCallbackEvent({ callbackId: old.id, companyId, type: "cancelled", actorUserId: session.userId, metadata: { note: note || null } });
  await recordAudit({ companyId, userId: session.userId, action: "callback.cancelled", entityType: "callback", entityId: old.id, before: { status: old.status }, after: { status: "cancelled", note: note || null } });
  await eventBus.emit("lead.updated", { leadId: old.leadId, companyId, changedFields: ["callbacks"] });
  return row;
}

export async function completeCallback(session: SessionPayload, id: string, outcome?: string) {
  const companyId = session.companyId!;
  const old = await requireActable(session, id);
  if (old.status === "completed" || old.status === "cancelled") throw new CallbackError(`Callback is already ${old.status}`);

  await cancelRemindersFor(old.id);
  const [row] = await db.update(callbacks).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(callbacks.id, old.id)).returning();

  await recordCallbackEvent({ callbackId: old.id, companyId, type: "completed", actorUserId: session.userId, metadata: { outcome: outcome || null, wasOverdue: old.scheduledAt.getTime() < Date.now() } });
  await recordAudit({ companyId, userId: session.userId, action: "callback.completed", entityType: "callback", entityId: old.id, before: { status: old.status }, after: { status: "completed", outcome: outcome || null } });
  await eventBus.emit("lead.updated", { leadId: old.leadId, companyId, changedFields: ["callbacks"] });
  return row;
}

// Dismissing the on-screen reminder. Deliberately NOT an audited state change —
// it only stops the banner re-appearing on reload; the callback stays open.
export async function acknowledgeCallback(session: SessionPayload, id: string) {
  const row = await requireActable(session, id);
  if (row.acknowledgedAt) return row;
  const [updated] = await db.update(callbacks).set({ acknowledgedAt: new Date(), updatedAt: new Date() }).where(eq(callbacks.id, row.id)).returning();
  await recordCallbackEvent({ callbackId: row.id, companyId: session.companyId!, type: "acknowledged", actorUserId: session.userId });
  return updated;
}

// ── Reads ───────────────────────────────────────────────────────────────────
export type CallbackTab = "today" | "upcoming" | "overdue" | "completed";

export interface ListInput {
  tab?: CallbackTab;
  search?: string;
  agentId?: string;
  priority?: string;
  reason?: string;
  limit?: number;
  offset?: number;
}

// One query per page, every branch indexed:
//   today/upcoming → callbacks_agent_status_idx / callbacks_company_scheduled_idx
//   overdue        → callbacks_status_scheduled_idx
export async function listCallbacks(session: SessionPayload, input: ListInput) {
  const companyId = session.companyId!;
  const tab: CallbackTab = input.tab ?? "today";
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const supervisor = hasPermission(session.role, "callbacks:supervise");

  const where: SQL[] = [eq(callbacks.companyId, companyId)];
  // Agents only ever see their own callbacks — enforced server-side, not by
  // the client omitting a filter.
  if (!supervisor) where.push(eq(callbacks.agentId, session.userId));
  else if (input.agentId) where.push(eq(callbacks.agentId, input.agentId));

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

  if (tab === "today") {
    where.push(inArray(callbacks.status, ["scheduled", "due"]));
    where.push(gte(callbacks.scheduledAt, startOfDay));
    where.push(lte(callbacks.scheduledAt, endOfDay));
  } else if (tab === "upcoming") {
    where.push(inArray(callbacks.status, ["scheduled", "due"]));
    where.push(sql`${callbacks.scheduledAt} > ${endOfDay}`);
  } else if (tab === "overdue") {
    where.push(inArray(callbacks.status, ["scheduled", "due", "missed"]));
    where.push(lt(callbacks.scheduledAt, now));
  } else {
    where.push(inArray(callbacks.status, ["completed", "cancelled"]));
  }

  if (input.priority) where.push(eq(callbacks.priority, input.priority));
  if (input.reason) where.push(eq(callbacks.reason, input.reason));
  if (input.search?.trim()) {
    const q = `%${input.search.trim()}%`;
    const match = or(ilike(leads.name, q), ilike(leads.phone, q), ilike(leads.email, q));
    if (match) where.push(match);
  }

  const rows = await db
    .select({
      id: callbacks.id, leadId: callbacks.leadId, agentId: callbacks.agentId,
      scheduledAt: callbacks.scheduledAt, timezone: callbacks.timezone, reason: callbacks.reason,
      notes: callbacks.notes, priority: callbacks.priority, status: callbacks.status,
      priorityScore: callbacks.priorityScore, rescheduleCount: callbacks.rescheduleCount,
      completedAt: callbacks.completedAt, createdAt: callbacks.createdAt,
      leadName: leads.name, leadPhone: leads.phone, leadDisposition: leads.disposition,
      agentName: users.name,
    })
    .from(callbacks)
    .leftJoin(leads, eq(callbacks.leadId, leads.id))
    .leftJoin(users, eq(callbacks.agentId, users.id))
    .where(and(...where))
    // AI prioritization decides the order of what's actionable now; history
    // reads chronologically.
    .orderBy(tab === "completed" ? desc(callbacks.completedAt) : tab === "upcoming" ? asc(callbacks.scheduledAt) : desc(callbacks.priorityScore))
    .limit(limit)
    .offset(offset);

  return rows;
}

// Tab counts for the dashboard header — one grouped aggregate, not four queries.
export async function callbackCounts(session: SessionPayload, agentId?: string) {
  const companyId = session.companyId!;
  const supervisor = hasPermission(session.role, "callbacks:supervise");
  const scope: SQL[] = [eq(callbacks.companyId, companyId)];
  if (!supervisor) scope.push(eq(callbacks.agentId, session.userId));
  else if (agentId) scope.push(eq(callbacks.agentId, agentId));

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const open = sql`${callbacks.status} in ('scheduled','due')`;

  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${open} and ${callbacks.scheduledAt} between ${startOfDay} and ${endOfDay})::int`,
      upcoming: sql<number>`count(*) filter (where ${open} and ${callbacks.scheduledAt} > ${endOfDay})::int`,
      overdue: sql<number>`count(*) filter (where ${callbacks.status} in ('scheduled','due','missed') and ${callbacks.scheduledAt} < ${now})::int`,
      completed: sql<number>`count(*) filter (where ${callbacks.status} in ('completed','cancelled'))::int`,
    })
    .from(callbacks)
    .where(and(...scope));
  return row ?? { today: 0, upcoming: 0, overdue: 0, completed: 0 };
}

// Reminders the agent hasn't dismissed yet. This is what makes a reminder
// survive a reload or an agent who was offline when it fired.
export async function getDueForUser(session: SessionPayload) {
  return db
    .select({
      callbackId: callbacks.id, leadId: callbacks.leadId, scheduledAt: callbacks.scheduledAt,
      reason: callbacks.reason, priority: callbacks.priority, priorityScore: callbacks.priorityScore,
      status: callbacks.status, leadName: leads.name,
    })
    .from(callbacks)
    .leftJoin(leads, eq(callbacks.leadId, leads.id))
    .where(and(
      eq(callbacks.companyId, session.companyId!),
      eq(callbacks.agentId, session.userId),
      inArray(callbacks.status, ["due", "missed"]),
      sql`${callbacks.acknowledgedAt} is null`,
    ))
    .orderBy(desc(callbacks.priorityScore))
    .limit(20);
}

// Callbacks shown inline on a Lead Details page.
export async function listCallbacksForLead(session: SessionPayload, leadId: string) {
  return db
    .select({
      id: callbacks.id, scheduledAt: callbacks.scheduledAt, timezone: callbacks.timezone,
      reason: callbacks.reason, notes: callbacks.notes, priority: callbacks.priority,
      status: callbacks.status, agentId: callbacks.agentId, agentName: users.name,
      rescheduleCount: callbacks.rescheduleCount, completedAt: callbacks.completedAt, createdAt: callbacks.createdAt,
    })
    .from(callbacks)
    .leftJoin(users, eq(callbacks.agentId, users.id))
    .where(and(eq(callbacks.companyId, session.companyId!), eq(callbacks.leadId, leadId)))
    .orderBy(desc(callbacks.scheduledAt))
    .limit(50);
}
