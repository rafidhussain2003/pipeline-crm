// Phase 10 — internal health monitoring. One place that answers "is each
// subsystem healthy / warning / critical right now", built entirely from data
// the app already has (a cheap DB ping, the durable queue's own health view,
// presence gauges, source status, recent delivery failures, the in-process
// metrics/timings). Read-only and bounded — safe to hit frequently. This is
// NOT a customer feature: it's surfaced only to the platform owner (super_admin)
// and to uptime probes.
import os from "os";
import { db } from "@/db";
import { leadSources, webhookLogs } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { metrics } from "@/lib/infra/metrics";
import { getQueueHealth } from "@/lib/lifecycle/health";
import { getActiveProviderName } from "@/lib/ai/config";

export type HealthStatus = "healthy" | "warning" | "critical";

export interface SubsystemHealth {
  name: string;
  status: HealthStatus;
  detail: string;
  data?: Record<string, unknown>;
}

export interface SystemHealth {
  status: HealthStatus; // worst of all subsystems
  checks: SubsystemHealth[];
  timings: ReturnType<typeof metrics.timingSnapshot>;
  cache: ReturnType<typeof cache.stats>;
  system: {
    uptimeSeconds: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
    loadAvg1m: number | null;
    cpuCount: number;
    nodeVersion: string;
    pid: number;
  };
  generatedAt: string;
}

const RANK: Record<HealthStatus, number> = { healthy: 0, warning: 1, critical: 2 };
function worst(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "healthy");
}

// ── Individual subsystem checks ─────────────────────────────────────────────

async function checkDatabase(): Promise<SubsystemHealth> {
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    const ms = Date.now() - t0;
    metrics.recordTiming("db.ping_ms", ms);
    // Schema-applied check (cheap, read-only) — catches "migrations not run".
    await db.execute(sql`SELECT 1 FROM users LIMIT 0`);
    const status: HealthStatus = ms > 750 ? "critical" : ms > 150 ? "warning" : "healthy";
    return { name: "database", status, detail: `ping ${ms}ms`, data: { pingMs: ms } };
  } catch (err) {
    return { name: "database", status: "critical", detail: `unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkQueue(): Promise<SubsystemHealth> {
  try {
    const q = await getQueueHealth();
    let status: HealthStatus = "healthy";
    if (q.deadLetterCount > 100 || (q.oldestQueuedAgeSeconds ?? 0) > 3600) status = "critical";
    else if (q.queueDepth > 1000 || (q.oldestQueuedAgeSeconds ?? 0) > 300 || q.deadLetterCount > 0) status = "warning";
    return {
      name: "queue",
      status,
      detail: `depth ${q.queueDepth}, processing ${q.processing}, dead-letter ${q.deadLetterCount}, oldest ${q.oldestQueuedAgeSeconds ?? 0}s`,
      data: { queueDepth: q.queueDepth, processing: q.processing, deadLetterCount: q.deadLetterCount, oldestQueuedAgeSeconds: q.oldestQueuedAgeSeconds },
    };
  } catch (err) {
    return { name: "queue", status: "critical", detail: `queue health failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkAssignment(): SubsystemHealth {
  const snap = metrics.snapshot();
  const decision = metrics.timingSummary("assignment.decision_ms");
  const dead = snap["assignment.job_dead_lettered"];
  let status: HealthStatus = "healthy";
  if (dead > 50 || (decision.p95Ms ?? 0) > 15000) status = "critical";
  else if (dead > 0 || (decision.p95Ms ?? 0) > 5000) status = "warning";
  return {
    name: "assignment",
    status,
    detail: `decision p95 ${decision.p95Ms ?? 0}ms, assigned ${snap["assignment.assigned"]}, dead-lettered ${dead}, claim-lost ${snap["assignment.claim_lost"]}`,
    data: { decisionP95Ms: decision.p95Ms, assigned: snap["assignment.assigned"], deadLettered: dead, claimLost: snap["assignment.claim_lost"] },
  };
}

function checkPresence(): SubsystemHealth {
  const snap = metrics.snapshot();
  const lost = snap["presence.heartbeat_lost"];
  const received = snap["presence.heartbeat_received"];
  // Only meaningful once heartbeats have flowed; a high lost:received ratio is
  // the warning signal (agents dropping off).
  const ratio = received > 0 ? lost / received : 0;
  const status: HealthStatus = received > 100 && ratio > 0.25 ? "warning" : "healthy";
  return { name: "presence", status, detail: `heartbeats received ${received}, lost ${lost}, restored ${snap["presence.heartbeat_restored"]}`, data: { received, lost, ratio: Math.round(ratio * 100) / 100 } };
}

async function checkMeta(): Promise<SubsystemHealth> {
  try {
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        degraded: sql<number>`count(*) FILTER (WHERE ${leadSources.status} in ('error','expired') OR (${leadSources.tokenExpiresAt} is not null AND ${leadSources.tokenExpiresAt} < now()))::int`,
      })
      .from(leadSources)
      .where(and(eq(leadSources.platform, "facebook"), sql`${leadSources.deletedAt} is null`));
    const total = Number(row?.total ?? 0);
    const degraded = Number(row?.degraded ?? 0);
    const status: HealthStatus = total === 0 ? "healthy" : degraded > 0 ? "warning" : "healthy";
    return { name: "meta", status, detail: total === 0 ? "no Facebook sources connected" : `${degraded}/${total} sources degraded (error/expired token)`, data: { total, degraded } };
  } catch (err) {
    return { name: "meta", status: "warning", detail: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkWebsiteForms(): Promise<SubsystemHealth> {
  try {
    const since = new Date(Date.now() - 3600_000);
    const [row] = await db
      .select({ failed: sql<number>`count(*)::int` })
      .from(webhookLogs)
      .innerJoin(leadSources, eq(webhookLogs.sourceId, leadSources.id))
      .where(and(eq(leadSources.platform, "website"), eq(webhookLogs.status, "failed"), gte(webhookLogs.createdAt, since)));
    const failed = Number(row?.failed ?? 0);
    const status: HealthStatus = failed > 200 ? "critical" : failed > 50 ? "warning" : "healthy";
    return { name: "website_forms", status, detail: `${failed} failed submissions in the last hour`, data: { failedLastHour: failed } };
  } catch (err) {
    return { name: "website_forms", status: "warning", detail: `check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkMailbox(): SubsystemHealth {
  // Platform-owner mailbox sends via Resend. Unconfigured = degraded (inbound
  // still stored; outbound send will fail), not down.
  const configured = !!process.env.RESEND_API_KEY;
  return { name: "mailbox", status: configured ? "healthy" : "warning", detail: configured ? "Resend configured" : "RESEND_API_KEY not set — outbound email disabled", data: { configured } };
}

function checkOperations(): SubsystemHealth {
  // The Operations Center runs on the in-process event bus + activity hub —
  // available whenever the process is up. Nothing external to be down.
  return { name: "operations", status: "healthy", detail: "in-process event bus + activity hub available" };
}

function checkAI(): SubsystemHealth {
  const provider = getActiveProviderName();
  const recompute = metrics.timingSummary("insights.recompute_ms");
  const status: HealthStatus = (recompute.p95Ms ?? 0) > 10000 ? "warning" : "healthy";
  return {
    name: "ai",
    status,
    detail: `insight engine deterministic (provider: ${provider}), recompute p95 ${recompute.p95Ms ?? 0}ms`,
    data: { provider, recomputeP95Ms: recompute.p95Ms, recomputeCount: recompute.count },
  };
}

function checkStorage(): SubsystemHealth {
  // No object storage to be down — lead attachments are external URLs, not
  // uploaded files. (Redis is likewise not used: caches/queues are in-process
  // with a documented Redis swap-seam.)
  return { name: "storage", status: "healthy", detail: "No object storage required (attachments are external URLs); caches/queues in-process" };
}

function checkSystem(): SubsystemHealth {
  const mem = process.memoryUsage();
  const heapRatio = mem.heapUsed / Math.max(1, mem.heapTotal);
  const status: HealthStatus = heapRatio > 0.95 ? "critical" : heapRatio > 0.85 ? "warning" : "healthy";
  return {
    name: "system",
    status,
    detail: `heap ${Math.round(mem.heapUsed / 1048576)}MB/${Math.round(mem.heapTotal / 1048576)}MB, rss ${Math.round(mem.rss / 1048576)}MB, up ${Math.round(process.uptime())}s`,
    data: { heapUsedMb: Math.round(mem.heapUsed / 1048576), rssMb: Math.round(mem.rss / 1048576) },
  };
}

// ── Aggregate ───────────────────────────────────────────────────────────────

export async function getSystemHealth(): Promise<SystemHealth> {
  // DB-touching checks in parallel; pure in-memory checks are synchronous.
  const [database, queue, meta, websiteForms] = await Promise.all([checkDatabase(), checkQueue(), checkMeta(), checkWebsiteForms()]);
  const checks: SubsystemHealth[] = [
    database,
    queue,
    checkAssignment(),
    checkPresence(),
    meta,
    websiteForms,
    checkMailbox(),
    checkOperations(),
    checkAI(),
    checkStorage(),
    checkSystem(),
  ];
  const mem = process.memoryUsage();
  let loadAvg1m: number | null = null;
  try {
    loadAvg1m = os.loadavg()[0] ?? null;
  } catch {
    /* not available on all platforms */
  }
  return {
    status: worst(checks.map((c) => c.status)),
    checks,
    timings: metrics.timingSnapshot(),
    cache: cache.stats(),
    system: {
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), heapTotalMb: Math.round(mem.heapTotal / 1048576) },
      loadAvg1m: loadAvg1m != null ? Math.round(loadAvg1m * 100) / 100 : null,
      cpuCount: os.cpus()?.length ?? 0,
      nodeVersion: process.version,
      pid: process.pid,
    },
    generatedAt: new Date().toISOString(),
  };
}
