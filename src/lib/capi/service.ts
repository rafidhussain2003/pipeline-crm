// Phase 11 — CAPI orchestration used by the API routes: pixel config CRUD (with
// default mapping seeding), mapping edits, historical resend (deduped),
// diagnostics, and the delivery log. All functions are company-scoped —
// tenant isolation is enforced here so no route can leak or cross conversions.
import { db } from "@/db";
import { capiPixels, capiEventMappings, capiEvents, connectedAccounts, dispositionOptions, leads } from "@/db/schema";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { SYSTEM_TRIGGERS, defaultMetaEventFor, resolveEvent } from "./mapping";
import { buildMetaEvent, type LeadForEvent } from "./events";
import { getActivePixels, getMappings, invalidateMappingCache, invalidatePixelCache } from "./config";
import { kickCapiWorker } from "./queue";
import { aggregateEmq, type EmqRating } from "./emq";

export async function listPixelConfigs(companyId: string) {
  return db
    .select({
      id: capiPixels.id, businessName: capiPixels.businessName, adAccountName: capiPixels.adAccountName,
      pixelId: capiPixels.pixelId, pixelName: capiPixels.pixelName, datasetId: capiPixels.datasetId,
      testEventCode: capiPixels.testEventCode, active: capiPixels.active, accountId: capiPixels.accountId, createdAt: capiPixels.createdAt,
      hasToken: sql<boolean>`(${capiPixels.accessToken} is not null)`,
    })
    .from(capiPixels)
    .where(and(eq(capiPixels.companyId, companyId), isNull(capiPixels.deletedAt)))
    .orderBy(desc(capiPixels.createdAt));
}

async function companyTriggers(companyId: string): Promise<{ key: string; label: string; kind: "system" | "disposition" }[]> {
  const dispositions = await db.select({ label: dispositionOptions.label }).from(dispositionOptions).where(eq(dispositionOptions.companyId, companyId)).orderBy(dispositionOptions.sortOrder);
  const dispTriggers = dispositions.map((d) => ({ key: d.label, label: d.label, kind: "disposition" as const }));
  return [...SYSTEM_TRIGGERS.map((t) => ({ ...t, kind: "system" as const })), ...dispTriggers];
}

// Create a pixel config + seed a sensible mapping for every trigger so it works
// immediately. accessToken (if provided) is encrypted; otherwise the reused
// account token is used at send time.
export async function createPixelConfig(params: {
  companyId: string; createdBy: string | null; accountId: string | null;
  businessId?: string | null; businessName?: string | null; adAccountId?: string | null; adAccountName?: string | null;
  pixelId: string; pixelName?: string | null; datasetId?: string | null; accessToken?: string | null; testEventCode?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(capiPixels)
    .values({
      companyId: params.companyId, createdBy: params.createdBy, accountId: params.accountId,
      businessId: params.businessId ?? null, businessName: params.businessName ?? null,
      adAccountId: params.adAccountId ?? null, adAccountName: params.adAccountName ?? null,
      pixelId: params.pixelId, pixelName: params.pixelName ?? null, datasetId: params.datasetId ?? null,
      accessToken: params.accessToken ? encrypt(params.accessToken) : null,
      testEventCode: params.testEventCode ?? null,
    })
    .onConflictDoUpdate({
      target: [capiPixels.companyId, capiPixels.pixelId],
      // The unique index is PARTIAL (WHERE deleted_at IS NULL) — Postgres needs
      // the same predicate here to infer it as the arbiter.
      targetWhere: sql`${capiPixels.deletedAt} is null`,
      set: { active: true, deletedAt: null, pixelName: params.pixelName ?? null, businessName: params.businessName ?? null, adAccountName: params.adAccountName ?? null, updatedAt: new Date(), ...(params.accessToken ? { accessToken: encrypt(params.accessToken) } : {}), ...(params.testEventCode !== undefined ? { testEventCode: params.testEventCode ?? null } : {}) },
    })
    .returning({ id: capiPixels.id });

  // Seed default mappings for any trigger that doesn't have one yet.
  const triggers = await companyTriggers(params.companyId);
  const existing = new Set((await db.select({ trigger: capiEventMappings.trigger }).from(capiEventMappings).where(eq(capiEventMappings.pixelId, row.id))).map((r) => r.trigger));
  const toSeed = triggers.filter((t) => !existing.has(t.key));
  if (toSeed.length > 0) {
    await db.insert(capiEventMappings).values(toSeed.map((t) => ({ companyId: params.companyId, pixelId: row.id, trigger: t.key, metaEvent: defaultMetaEventFor(t.key), enabled: true }))).onConflictDoNothing();
  }
  invalidatePixelCache(params.companyId);
  invalidateMappingCache(row.id);
  return row.id;
}

export async function deletePixelConfig(id: string, companyId: string): Promise<boolean> {
  const res = await db.update(capiPixels).set({ active: false, deletedAt: new Date() }).where(and(eq(capiPixels.id, id), eq(capiPixels.companyId, companyId))).returning({ id: capiPixels.id });
  invalidatePixelCache(companyId);
  return res.length > 0;
}

// Every trigger for a pixel (seeded + any not-yet-seeded), with its current
// mapped event — for the Event Mapping UI.
export async function getMappingUi(pixelId: string, companyId: string) {
  const pixel = await db.select({ id: capiPixels.id }).from(capiPixels).where(and(eq(capiPixels.id, pixelId), eq(capiPixels.companyId, companyId))).limit(1);
  if (pixel.length === 0) return null;
  const [triggers, rows] = await Promise.all([
    companyTriggers(companyId),
    db.select({ trigger: capiEventMappings.trigger, metaEvent: capiEventMappings.metaEvent, enabled: capiEventMappings.enabled }).from(capiEventMappings).where(eq(capiEventMappings.pixelId, pixelId)),
  ]);
  const byTrigger = new Map(rows.map((r) => [r.trigger, r]));
  return triggers.map((t) => {
    const m = byTrigger.get(t.key);
    return { trigger: t.key, label: t.label, kind: t.kind, metaEvent: m ? m.metaEvent : defaultMetaEventFor(t.key), enabled: m ? m.enabled : true };
  });
}

export async function updateMappings(pixelId: string, companyId: string, rows: { trigger: string; metaEvent: string | null; enabled: boolean }[]): Promise<boolean> {
  const pixel = await db.select({ id: capiPixels.id }).from(capiPixels).where(and(eq(capiPixels.id, pixelId), eq(capiPixels.companyId, companyId))).limit(1);
  if (pixel.length === 0) return false;
  for (const r of rows) {
    await db
      .insert(capiEventMappings)
      .values({ companyId, pixelId, trigger: r.trigger, metaEvent: r.metaEvent, enabled: r.enabled })
      .onConflictDoUpdate({ target: [capiEventMappings.pixelId, capiEventMappings.trigger], set: { metaEvent: r.metaEvent, enabled: r.enabled, updatedAt: new Date() } });
  }
  invalidateMappingCache(pixelId);
  return true;
}

// Historical resend: for leads in the date range, (re)queue their CURRENT
// disposition's mapped event as origin='historical'. Deduplicated by the
// (pixel, event_id) unique index — a conversion already sent live is skipped.
export async function resendHistorical(companyId: string, params: { fromMs: number; toMs: number }): Promise<{ scanned: number; queued: number; deduped: number }> {
  const pixels = await getActivePixels(companyId);
  if (pixels.length === 0) return { scanned: 0, queued: 0, deduped: 0 };

  const rows = await db
    .select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, state: leads.state, rawPayload: leads.rawPayload, createdAt: leads.createdAt, disposition: leads.disposition })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), gte(leads.createdAt, new Date(params.fromMs)), lte(leads.createdAt, new Date(params.toMs)), isNull(leads.deletedAt)))
    .limit(5000);

  let queued = 0;
  let deduped = 0;
  for (const lead of rows) {
    for (const pixel of pixels) {
      const mappings = await getMappings(pixel.id);
      const eventName = resolveEvent(mappings, lead.disposition);
      if (!eventName) continue;
      const built = buildMetaEvent({ lead: lead as LeadForEvent, eventName, trigger: lead.disposition, eventTimeMs: lead.createdAt.getTime() });
      const inserted = await db
        .insert(capiEvents)
        .values({ companyId, pixelConfigId: pixel.id, leadId: lead.id, eventName: built.eventName, eventId: built.eventId, eventTime: lead.createdAt, trigger: lead.disposition, origin: "historical", status: "pending", payload: { event: built.event }, matchKeys: built.matchKeys, eventMatchQuality: built.emq })
        .onConflictDoNothing()
        .returning({ id: capiEvents.id });
      if (inserted.length > 0) queued++;
      else deduped++;
    }
  }
  if (queued > 0) kickCapiWorker();
  return { scanned: rows.length, queued, deduped };
}

// Paginated Conversions Delivery Log.
export async function getDeliveryLog(companyId: string, opts: { page?: number; pixelConfigId?: string; status?: string } = {}) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = 50;
  const conds = [eq(capiEvents.companyId, companyId)];
  if (opts.pixelConfigId) conds.push(eq(capiEvents.pixelConfigId, opts.pixelConfigId));
  if (opts.status) conds.push(eq(capiEvents.status, opts.status as typeof capiEvents.$inferSelect.status));
  const rows = await db
    .select({
      id: capiEvents.id, eventName: capiEvents.eventName, status: capiEvents.status, trigger: capiEvents.trigger,
      leadName: leads.name, leadId: capiEvents.leadId, pixelName: capiPixels.pixelName, pixelId: capiPixels.pixelId,
      httpStatus: capiEvents.httpStatus, latencyMs: capiEvents.latencyMs, attempts: capiEvents.attempts,
      eventMatchQuality: capiEvents.eventMatchQuality, metaResponse: capiEvents.metaResponse, lastError: capiEvents.lastError,
      origin: capiEvents.origin, createdAt: capiEvents.createdAt,
    })
    .from(capiEvents)
    .leftJoin(leads, eq(capiEvents.leadId, leads.id))
    .leftJoin(capiPixels, eq(capiEvents.pixelConfigId, capiPixels.id))
    .where(and(...conds))
    .orderBy(desc(capiEvents.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { events: rows, page, pageSize };
}

// Diagnostics: connection status + delivery health for the company.
export async function getDiagnostics(companyId: string) {
  const pixels = await listPixelConfigs(companyId);
  const account = pixels[0]?.accountId
    ? (await db.select({ status: connectedAccounts.status, token: connectedAccounts.accessToken, expires: connectedAccounts.tokenExpiresAt, label: connectedAccounts.accountLabel }).from(connectedAccounts).where(eq(connectedAccounts.id, pixels[0].accountId!)).limit(1))[0]
    : null;

  const since = new Date(Date.now() - 24 * 3600_000);
  const statusRows = await db
    .select({ status: capiEvents.status, n: sql<number>`count(*)::int`, avgLatency: sql<number | null>`avg(${capiEvents.latencyMs})` })
    .from(capiEvents)
    .where(and(eq(capiEvents.companyId, companyId), gte(capiEvents.createdAt, since)))
    .groupBy(capiEvents.status);
  const byStatus = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
  const total = statusRows.reduce((s, r) => s + Number(r.n), 0);
  const sent = byStatus.get("sent") ?? 0;
  const failed = (byStatus.get("failed") ?? 0) + (byStatus.get("dead_letter") ?? 0);
  const avgLatency = statusRows.find((r) => r.status === "sent")?.avgLatency ?? null;

  const recent = await db
    .select({ eventName: capiEvents.eventName, status: capiEvents.status, emq: capiEvents.eventMatchQuality, createdAt: capiEvents.createdAt })
    .from(capiEvents)
    .where(eq(capiEvents.companyId, companyId))
    .orderBy(desc(capiEvents.createdAt))
    .limit(10);
  const emqAgg = aggregateEmq(recent.map((r) => (r.emq as EmqRating) || "poor"));

  return {
    pixelConnected: pixels.length > 0,
    datasetConnected: pixels.some((p) => !!p.datasetId || !!p.pixelId),
    oauth: { status: account?.status ?? (pixels.length > 0 ? "unknown" : "not_connected"), hasToken: !!(account?.token) || pixels.some((p) => p.hasToken), tokenExpiresAt: account?.expires ?? null, accountLabel: account?.label ?? null },
    permissions: pixels.some((p) => p.hasToken) || !!account?.token ? "granted" : "missing_token",
    events24h: total,
    successRate: total > 0 ? Math.round((sent / total) * 100) : null,
    failureRate: total > 0 ? Math.round((failed / total) * 100) : null,
    avgLatencyMs: avgLatency != null ? Math.round(Number(avgLatency)) : null,
    eventMatchQuality: emqAgg,
    recentEvents: recent,
    pixels,
  };
}

export async function getConnectedMetaAccounts(companyId: string) {
  return db
    .select({ id: connectedAccounts.id, label: connectedAccounts.accountLabel, status: connectedAccounts.status, hasToken: sql<boolean>`(${connectedAccounts.accessToken} is not null)` })
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.companyId, companyId), eq(connectedAccounts.platform, "facebook"), isNull(connectedAccounts.deletedAt)));
}
