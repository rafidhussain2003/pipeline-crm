// Phase 15 — the durable reminder queue + worker. Same battle-tested model as
// the assignment and Conversions API queues: work is ROWS (survives restarts),
// the worker reserves due rows with FOR UPDATE SKIP LOCKED (any number of
// instances drain concurrently, zero double-send), failures retry with
// exponential backoff and dead-letter after maxAttempts.
//
// Why this scales to 100k+ scheduled callbacks with thousands due at once:
//   • dueAt is PRECOMPUTED at scheduling time, so the worker only ever runs an
//     indexed "due now" scan — never a scan over all callbacks.
//   • reservation + delivery happen in bounded BATCHES that yield between
//     passes, so a thundering herd never blocks the event loop or the DB.
//   • nothing in the request path waits on a reminder.
import { db } from "@/db";
import { callbacks, callbackReminders, leadInsights, leads, users } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createLogger } from "@/lib/logger";
import { sendNotification } from "@/lib/notifications/service";
import { getCallbackSettings, type CallbackSettings } from "./config";
import { computePriorityScore } from "./prioritize";
import { getChannel } from "./channels";
import { recordCallbackEvent } from "./history";
import { kindForOffset, labelForKind } from "./types";

const logger = createLogger({ component: "callback-reminders" });
const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;

// ── Scheduling ──────────────────────────────────────────────────────────────
// One reminder row per configured offset. Offsets already in the past are
// skipped (a "15 minutes before" reminder for a callback 2 minutes away is
// moot). Idempotent via the (callbackId, kind, channel) unique index.
export async function scheduleRemindersFor(cb: { id: string; companyId: string; agentId: string; scheduledAt: Date }, settings?: CallbackSettings): Promise<number> {
  const s = settings ?? (await getCallbackSettings(cb.companyId));
  const now = Date.now();
  const rows = s.reminderOffsets
    .map((offset) => ({ offset, dueAt: new Date(cb.scheduledAt.getTime() + offset * 60_000) }))
    .filter(({ dueAt }) => dueAt.getTime() > now - 60_000) // skip moot past offsets
    .map(({ offset, dueAt }) => ({
      callbackId: cb.id,
      companyId: cb.companyId,
      agentId: cb.agentId,
      offsetMinutes: offset,
      kind: kindForOffset(offset),
      dueAt,
      channel: "in_app" as const,
      availableAt: dueAt, // not reservable until it's actually due
    }));
  if (rows.length === 0) return 0;
  const inserted = await db.insert(callbackReminders).values(rows).onConflictDoNothing().returning({ id: callbackReminders.id });
  return inserted.length;
}

// Called whenever a callback stops needing reminders (completed / cancelled /
// rescheduled). Only pending/failed rows are cancelled — sent history is kept.
export async function cancelRemindersFor(callbackId: string): Promise<void> {
  await db
    .update(callbackReminders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(callbackReminders.callbackId, callbackId), inArray(callbackReminders.status, ["pending", "failed"])));
}

// ── Queue operations ────────────────────────────────────────────────────────
interface ReservedReminder {
  id: string;
  callbackId: string;
  companyId: string;
  agentId: string;
  kind: string;
  channel: string;
  attempts: number;
  maxAttempts: number;
}

async function reserveDue(limit: number): Promise<ReservedReminder[]> {
  const res = await db.execute(sql`
    UPDATE callback_reminders SET status = 'processing', locked_at = now(), locked_by = ${WORKER_ID}, updated_at = now()
    WHERE id IN (
      SELECT id FROM callback_reminders
      WHERE status IN ('pending','failed') AND available_at <= now() AND due_at <= now()
      ORDER BY due_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, callback_id, company_id, agent_id, kind, channel, attempts, max_attempts
  `);
  const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  return rows.map((r) => ({
    id: r.id as string,
    callbackId: r.callback_id as string,
    companyId: r.company_id as string,
    agentId: r.agent_id as string,
    kind: r.kind as string,
    channel: r.channel as string,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
  }));
}

async function markSent(id: string): Promise<void> {
  await db.update(callbackReminders).set({ status: "sent", sentAt: new Date(), attempts: sql`${callbackReminders.attempts} + 1`, lockedAt: null, lockedBy: null, lastError: null, updatedAt: new Date() }).where(eq(callbackReminders.id, id));
}
async function markCancelled(id: string, reason: string): Promise<void> {
  await db.update(callbackReminders).set({ status: "cancelled", lastError: reason, lockedAt: null, lockedBy: null, updatedAt: new Date() }).where(eq(callbackReminders.id, id));
}
async function retryOrDeadLetter(r: ReservedReminder, error: string): Promise<void> {
  const attempts = r.attempts + 1;
  if (attempts >= r.maxAttempts) {
    await db.update(callbackReminders).set({ status: "dead_letter", attempts, lastError: error, lockedAt: null, lockedBy: null, updatedAt: new Date() }).where(eq(callbackReminders.id, r.id));
    logger.warn("reminder_dead_lettered", { id: r.id, callbackId: r.callbackId, attempts, error });
    return;
  }
  const backoffSeconds = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS) / 1000;
  await db.execute(sql`
    UPDATE callback_reminders SET status='failed', attempts=${attempts}, last_error=${error},
      available_at = now() + make_interval(secs => ${backoffSeconds}), locked_at=null, locked_by=null, updated_at=now()
    WHERE id = ${r.id}
  `);
}

// Notify the agent's manager(s)/admin(s) that a callback was missed.
async function escalate(companyId: string, callbackId: string, leadName: string | null, settings: CallbackSettings): Promise<void> {
  const roles: string[] = [];
  if (settings.notifyManager) roles.push("manager");
  if (settings.notifyAdmin) roles.push("admin");
  if (roles.length === 0) return;
  const supervisors = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, companyId), inArray(users.role, roles as ("manager" | "admin")[]), eq(users.active, true)));
  for (const s of supervisors) {
    await sendNotification({
      companyId,
      userId: s.id,
      type: "callback.missed",
      title: "Callback missed",
      body: `A callback for ${leadName || "a lead"} was not completed in time.`,
      metadata: { callbackId },
    }).catch(() => {});
  }
}

// How many reminders are delivered at once within a reserved batch. Each one
// costs several DB round-trips, so processing them strictly one-at-a-time makes
// throughput a function of network latency — at ~20ms round-trips a batch of
// 5,000 would take minutes. This is capped well under the pg pool's max of 20
// so the worker can never starve the request path of connections.
const DELIVERY_CONCURRENCY = 8;

// Reserve a batch, deliver each through its channel, and advance the callback's
// own state (scheduled → due at the scheduled time; → missed once past the
// escalation window). Returns counts so the cron can report progress.
export async function processDueReminders(limit = 100): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  const reserved = await reserveDue(limit);
  if (reserved.length === 0) return { processed: 0, sent: 0, failed: 0, skipped: 0 };

  // Reminders for the SAME callback must stay ordered relative to each other —
  // they all read-then-write that callback's status/escalatedAt, so running two
  // concurrently could double-escalate. Grouping by callbackId keeps each
  // callback strictly sequential while different callbacks run in parallel.
  const groups = new Map<string, ReservedReminder[]>();
  for (const r of reserved) {
    const g = groups.get(r.callbackId);
    if (g) g.push(r);
    else groups.set(r.callbackId, [r]);
  }

  let sent = 0, failed = 0, skipped = 0;
  const queue = [...groups.values()];
  let cursor = 0;
  const runner = async () => {
    while (cursor < queue.length) {
      const group = queue[cursor++];
      for (const r of group) await processOne(r);
    }
  };

  async function processOne(r: ReservedReminder): Promise<void> {
    try {
      // Load the callback + its lead's signals in one indexed read.
      const [row] = await db
        .select({
          id: callbacks.id, status: callbacks.status, scheduledAt: callbacks.scheduledAt, reason: callbacks.reason,
          priority: callbacks.priority, leadId: callbacks.leadId, escalatedAt: callbacks.escalatedAt,
          leadName: leads.name, leadCreatedAt: leads.createdAt, disposition: leads.disposition, isDuplicate: leads.isDuplicate,
          leadScore: leadInsights.score,
        })
        .from(callbacks)
        .leftJoin(leads, eq(callbacks.leadId, leads.id))
        .leftJoin(leadInsights, eq(leadInsights.leadId, callbacks.leadId))
        .where(eq(callbacks.id, r.callbackId))
        .limit(1);

      // Only a CLOSED callback makes its reminders moot. "missed" deliberately
      // is not closed: a missed callback still needs its later overdue nudges
      // (the sweep, or an earlier overdue reminder, may already have marked it
      // missed before the +60 reminder comes due — dropping that nudge would
      // silence exactly the callbacks that need chasing most).
      if (!row || row.status === "completed" || row.status === "cancelled" || row.status === "rescheduled") {
        await markCancelled(r.id, "callback no longer open");
        skipped++;
        return;
      }

      const settings = await getCallbackSettings(r.companyId);
      const score = computePriorityScore({
        scheduledAt: row.scheduledAt,
        priority: row.priority,
        leadScore: row.leadScore ?? null,
        leadCreatedAt: row.leadCreatedAt ?? null,
        disposition: row.disposition ?? null,
        isDuplicate: row.isDuplicate ?? null,
      });

      // State advance: at the scheduled time the callback becomes "due"; past
      // the escalation window it becomes "missed".
      let status: string = row.status;
      if (row.status === "scheduled" && r.kind === "at_time") status = "due";
      const overdueMs = Date.now() - row.scheduledAt.getTime();
      const shouldMiss = overdueMs >= settings.escalateAfterMinutes * 60_000;
      if (shouldMiss) status = "missed";
      // Only stamp missedAt on the transition — a later overdue reminder must
      // not keep resetting when it was first missed.
      const justMissed = shouldMiss && row.status !== "missed";

      await db.update(callbacks).set({ status: status as typeof callbacks.$inferSelect.status, priorityScore: score, missedAt: justMissed ? new Date() : undefined, updatedAt: new Date() }).where(eq(callbacks.id, row.id));

      if (shouldMiss && !row.escalatedAt) {
        await db.update(callbacks).set({ escalatedAt: new Date() }).where(eq(callbacks.id, row.id));
        await escalate(r.companyId, row.id, row.leadName ?? null, settings);
        await recordCallbackEvent({ callbackId: row.id, companyId: r.companyId, type: "escalated", metadata: { kind: r.kind } });
        await recordCallbackEvent({ callbackId: row.id, companyId: r.companyId, type: "missed", metadata: { overdueMinutes: Math.round(overdueMs / 60_000) } });
      }

      // Deliver through the reminder's channel (in_app today; future channels
      // register in ./channels with no change here).
      const result = await getChannel(r.channel).deliver({
        callbackId: row.id, companyId: r.companyId, agentId: r.agentId, leadId: row.leadId,
        kind: r.kind, scheduledAt: row.scheduledAt, reason: row.reason, priority: row.priority, priorityScore: score, status,
      });

      if (result.ok) {
        await markSent(r.id);
        await recordCallbackEvent({ callbackId: row.id, companyId: r.companyId, type: "reminder_sent", metadata: { kind: r.kind, channel: r.channel, label: labelForKind(r.kind) } });
        sent++;
      } else {
        await retryOrDeadLetter(r, result.reason);
        failed++;
      }
    } catch (err) {
      await retryOrDeadLetter(r, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  await Promise.all(Array.from({ length: Math.min(DELIVERY_CONCURRENCY, queue.length) }, runner));
  return { processed: reserved.length, sent, failed, skipped };
}

// Fire-and-forget single-flight kick (same pattern as the assignment/CAPI
// workers). Drains due work until empty, then stops. Never awaited by a request.
let running = false;
export function kickCallbackWorker(): void {
  if (running) return;
  running = true;
  (async () => {
    try {
      let batch = await processDueReminders(100);
      let guard = 0;
      while (batch.processed > 0 && guard < 200) {
        batch = await processDueReminders(100);
        guard++;
      }
    } catch (err) {
      logger.error("callback_worker_crashed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  })();
}

// Recovery: a worker that died mid-batch leaves rows 'processing'; return them
// once their reservation times out.
export async function reclaimStaleReminders(timeoutSeconds = 120): Promise<number> {
  const res = await db.execute(sql`
    UPDATE callback_reminders SET status='failed', available_at=now(), locked_at=null, locked_by=null, updated_at=now()
    WHERE status='processing' AND locked_at IS NOT NULL AND locked_at < now() - make_interval(secs => ${timeoutSeconds})
    RETURNING id
  `);
  const rows = (res as unknown as { rows: unknown[] }).rows ?? [];
  if (rows.length > 0) logger.warn("stale_reminders_reclaimed", { count: rows.length });
  return rows.length;
}

// Backstop: mark callbacks missed even if their reminder rows were lost/never
// created (e.g. offsets all in the past). Bounded + indexed.
//
// The join to callback_settings MUST be a LEFT JOIN: a company only has a
// settings row once an admin has changed something, so an inner join would
// silently skip every company still on the defaults — i.e. almost all of them.
// COALESCE mirrors DEFAULT_CALLBACK_SETTINGS.escalateAfterMinutes.
export async function sweepOverdueCallbacks(limit = 500): Promise<number> {
  const res = await db.execute(sql`
    UPDATE callbacks c SET status='missed', missed_at=now(), updated_at=now()
    WHERE c.id IN (
      SELECT c2.id FROM callbacks c2
      LEFT JOIN callback_settings s ON s.company_id = c2.company_id
      WHERE c2.status IN ('scheduled','due')
        AND c2.scheduled_at < now() - make_interval(mins => coalesce(s.escalate_after_minutes, 30))
      LIMIT ${limit}
    )
    RETURNING id
  `);
  const rows = (res as unknown as { rows: unknown[] }).rows ?? [];
  return rows.length;
}
