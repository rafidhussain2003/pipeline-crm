// Phase 11 — the durable Conversions API send queue + worker. Mirrors the
// Assignment Engine's proven durability model: work is rows in capi_events
// (survives restarts), the worker reserves due rows with FOR UPDATE SKIP LOCKED
// (any number of instances drain concurrently, zero double-send), sends are
// retried with exponential backoff and dead-lettered after maxAttempts, and a
// reconcile sweep backstops the in-memory enqueue so no conversion is lost.
//
// The Assignment Engine NEVER waits for Meta: enqueue is a deferred, in-memory,
// non-blocking call; the durable insert happens off the event-bus path; the
// HTTP send happens in the async worker.
import { db } from "@/db";
import { capiEvents, leads } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/infra/metrics";
import { getActivePixels, getMappings, getPixel, resolveSendToken, type PixelConfig } from "./config";
import { resolveEvent } from "./mapping";
import { buildMetaEvent, type LeadForEvent } from "./events";
import { sendEvents } from "./graph";

const logger = createLogger({ component: "capi-queue" });
const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 10 * 60_000;

// ── Enqueue (non-blocking, deferred, deduped) ───────────────────────────────
const pending = new Map<string, { leadId: string; trigger: string }>();
let scheduled = false;

export function enqueueCapiForLead(leadId: string, trigger: string): void {
  if (!leadId || !trigger) return;
  pending.set(`${leadId}|${trigger}`, { leadId, trigger });
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      void drainEnqueue();
    }, 0);
  }
}

// Test/inspection helpers: drain the enqueue buffer synchronously + read depth.
export async function flushCapiEnqueue(): Promise<void> {
  await drainEnqueue();
}
export function pendingCapiCount(): number {
  return pending.size;
}

async function leadForEvent(leadId: string): Promise<(LeadForEvent & { companyId: string }) | null> {
  const [row] = await db
    .select({ id: leads.id, companyId: leads.companyId, name: leads.name, phone: leads.phone, email: leads.email, state: leads.state, rawPayload: leads.rawPayload, createdAt: leads.createdAt })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  return row ?? null;
}

// Build + durably insert one capi_events row per (active pixel × mapped event)
// for each buffered (lead, trigger). ON CONFLICT DO NOTHING dedups by
// (pixel, event_id). Then kicks the worker.
async function drainEnqueue(): Promise<void> {
  if (pending.size === 0) return;
  const batch = Array.from(pending.values());
  pending.clear();
  let anyInserted = false;

  for (const { leadId, trigger } of batch) {
    try {
      const lead = await leadForEvent(leadId);
      if (!lead) continue;
      const pixels = await getActivePixels(lead.companyId);
      if (pixels.length === 0) continue;
      for (const pixel of pixels) {
        const mappings = await getMappings(pixel.id);
        const eventName = resolveEvent(mappings, trigger);
        if (!eventName) continue; // unmapped / No Event
        const built = buildMetaEvent({ lead, eventName, trigger, eventTimeMs: Date.now() });
        const inserted = await db
          .insert(capiEvents)
          .values({
            companyId: lead.companyId,
            pixelConfigId: pixel.id,
            leadId: lead.id,
            eventName: built.eventName,
            eventId: built.eventId,
            eventTime: new Date(),
            trigger,
            origin: "live",
            status: "pending",
            payload: { event: built.event },
            matchKeys: built.matchKeys,
            eventMatchQuality: built.emq,
          })
          .onConflictDoNothing()
          .returning({ id: capiEvents.id });
        if (inserted.length > 0) anyInserted = true;
      }
    } catch (err) {
      logger.error("capi_enqueue_failed", { leadId, trigger, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (anyInserted) kickCapiWorker();
}

// ── Durable queue operations ────────────────────────────────────────────────
interface ReservedCapi {
  id: string;
  companyId: string;
  pixelConfigId: string;
  eventId: string;
  attempts: number;
  maxAttempts: number;
  event: unknown;
}

async function reserveDueCapi(limit: number): Promise<ReservedCapi[]> {
  const res = await db.execute(sql`
    UPDATE capi_events SET status = 'processing', locked_at = now(), locked_by = ${WORKER_ID}, updated_at = now()
    WHERE id IN (
      SELECT id FROM capi_events
      WHERE status IN ('pending', 'failed') AND available_at <= now()
      ORDER BY available_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, company_id, pixel_config_id, event_id, attempts, max_attempts, payload
  `);
  const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  return rows.map((r) => ({
    id: r.id as string,
    companyId: r.company_id as string,
    pixelConfigId: r.pixel_config_id as string,
    eventId: r.event_id as string,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    event: (r.payload as { event?: unknown } | null)?.event ?? null,
  }));
}

async function markSent(ids: string[], httpStatus: number, response: unknown, latencyMs: number): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(sql`
    UPDATE capi_events
    SET status = 'sent', attempts = attempts + 1, http_status = ${httpStatus}, meta_response = ${JSON.stringify(response)}::jsonb,
        latency_ms = ${latencyMs}, last_error = null, locked_at = null, locked_by = null, updated_at = now()
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
}

async function retryOrDeadLetter(row: ReservedCapi, error: string, httpStatus: number | null, response: unknown, latencyMs: number | null): Promise<void> {
  const attempts = row.attempts + 1;
  const respJson = response != null ? sql`${JSON.stringify(response)}::jsonb` : sql`null`;
  if (attempts >= row.maxAttempts) {
    await db.execute(sql`
      UPDATE capi_events SET status = 'dead_letter', attempts = ${attempts}, http_status = ${httpStatus}, meta_response = ${respJson},
        latency_ms = ${latencyMs}, last_error = ${error}, locked_at = null, locked_by = null, updated_at = now()
      WHERE id = ${row.id}
    `);
    logger.warn("capi_event_dead_lettered", { id: row.id, attempts, error });
    return;
  }
  const backoffSeconds = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS) / 1000;
  await db.execute(sql`
    UPDATE capi_events SET status = 'failed', attempts = ${attempts}, http_status = ${httpStatus}, meta_response = ${respJson},
      latency_ms = ${latencyMs}, last_error = ${error}, available_at = now() + make_interval(secs => ${backoffSeconds}),
      locked_at = null, locked_by = null, updated_at = now()
    WHERE id = ${row.id}
  `);
}

// Reserve a batch, group by pixel, send each pixel's events in ONE request
// (Meta accepts up to 1000/req), and record each row's outcome.
export async function processDueCapiEvents(limit = 100): Promise<{ processed: number; sent: number; failed: number }> {
  const reserved = await reserveDueCapi(limit);
  if (reserved.length === 0) return { processed: 0, sent: 0, failed: 0 };

  const byPixel = new Map<string, ReservedCapi[]>();
  for (const r of reserved) {
    const arr = byPixel.get(r.pixelConfigId) || [];
    arr.push(r);
    byPixel.set(r.pixelConfigId, arr);
  }

  let sent = 0;
  let failed = 0;
  const pixelCache = new Map<string, { pixel: PixelConfig | null; token: string | null }>();

  for (const [pixelConfigId, rows] of byPixel) {
    let resolved = pixelCache.get(pixelConfigId);
    if (!resolved) {
      const pixel = await getPixel(pixelConfigId, rows[0].companyId);
      const token = pixel ? await resolveSendToken(pixel) : null;
      resolved = { pixel, token };
      pixelCache.set(pixelConfigId, resolved);
    }
    const { pixel, token } = resolved;

    if (!pixel || !token) {
      // Nothing to send with — retry (config may be fixed) until dead-letter.
      for (const r of rows) await retryOrDeadLetter(r, pixel ? "No send token configured for pixel" : "Pixel config missing", null, null, null);
      failed += rows.length;
      continue;
    }

    const events = rows.map((r) => r.event).filter(Boolean);
    const started = Date.now();
    const result = await sendEvents(pixel.pixelId, token, events, pixel.testEventCode);
    const latencyMs = Date.now() - started;
    metrics.recordTiming("capi.send_ms", latencyMs);

    if (result.ok) {
      await markSent(rows.map((r) => r.id), result.httpStatus, result.response, latencyMs);
      sent += rows.length;
    } else {
      for (const r of rows) await retryOrDeadLetter(r, result.error || "Send failed", result.httpStatus || null, result.response, latencyMs);
      failed += rows.length;
    }
  }

  return { processed: reserved.length, sent, failed };
}

// Fire-and-forget single-flight worker kick (same pattern as the assignment
// worker). Drains due work until empty, then stops.
let workerRunning = false;
export function kickCapiWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  (async () => {
    try {
      let batch = await processDueCapiEvents(100);
      let guard = 0;
      while (batch.processed > 0 && guard < 200) {
        batch = await processDueCapiEvents(100);
        guard++;
      }
    } catch (err) {
      logger.error("capi_worker_crashed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      workerRunning = false;
    }
  })();
}

// Recovery: return jobs a crashed worker left in 'processing' back to 'failed'
// (so they retry) once their reservation has timed out.
export async function reclaimStaleCapi(reservationTimeoutSeconds: number): Promise<number> {
  const res = await db.execute(sql`
    UPDATE capi_events SET status = 'failed', available_at = now(), locked_at = null, locked_by = null, updated_at = now()
    WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at < now() - make_interval(secs => ${reservationTimeoutSeconds})
    RETURNING id
  `);
  const rows = (res as unknown as { rows: unknown[] }).rows ?? [];
  if (rows.length > 0) logger.warn("capi_stale_reclaimed", { count: rows.length });
  return rows.length;
}

// Manual retry (Delivery Log button) — company-scoped. Requeues a failed /
// dead-lettered event immediately (attempts preserved for the log).
export async function retryCapiEvent(eventId: string, companyId: string): Promise<boolean> {
  const res = await db
    .update(capiEvents)
    .set({ status: "pending", availableAt: new Date(), lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(and(eq(capiEvents.id, eventId), eq(capiEvents.companyId, companyId)))
    .returning({ id: capiEvents.id });
  if (res.length > 0) kickCapiWorker();
  return res.length > 0;
}

// Durability backstop: re-enqueue the CURRENT disposition trigger for leads
// changed in the window. Safe + idempotent (drainEnqueue dedups by event_id),
// so any conversion missed by a lost in-memory enqueue is recovered.
export async function reconcileCapiEvents(sinceMinutes = 60, limit = 500): Promise<number> {
  const since = new Date(Date.now() - sinceMinutes * 60_000);
  const rows = await db
    .select({ id: leads.id, disposition: leads.disposition })
    .from(leads)
    .where(gte(leads.updatedAt, since))
    .limit(limit);
  for (const r of rows) enqueueCapiForLead(r.id, r.disposition);
  return rows.length;
}
