// In-memory counters for the categories of event Part 9 asks to track.
// Deliberately just a Map<string, number> with an increment function — a
// real metrics backend (Prometheus, Datadog, etc.) is a bigger decision
// than this phase should make unilaterally, but every call site here
// (`metrics.increment(...)`) stays the same the day that's introduced;
// only what's inside `increment`/`snapshot` changes.
//
// This resets on every process restart (deploys, crashes) — it's a
// point-in-time view since the last restart, not a durable history. That's
// fine for "is something actively wrong right now" (the system-health
// endpoint's job), not for long-term trend analysis (which needs a real
// metrics backend or the audit log, not this).
export type MetricName =
  | "http.auth_failure"
  | "http.permission_failure"
  | "http.validation_failure"
  | "http.slow_request"
  | "db.slow_query"
  | "job.completed"
  | "job.failed"
  | "job.dead_lettered"
  | "notification.failed"
  | "rate_limit.exceeded"
  | "ai.request"
  | "ai.success"
  | "ai.failure"
  | "ai.fallback_used"
  | "presence.heartbeat_lost"
  // Agent Presence Service monitoring (Phase 2).
  | "presence.heartbeat_received"
  | "presence.heartbeat_restored"
  | "presence.reconnect"
  | "presence.missed_beat"
  | "presence.state_transition"
  | "assignment.filtered_offline"
  | "assignment.filtered_workload"
  | "assignment.overflow_used"
  | "assignment.unassigned_no_agents"
  | "assignment.skipped_blacklisted"
  | "assignment.assigned"
  | "assignment.claim_lost"
  | "assignment.queue_drained"
  // Durable assignment-queue counters (Phase 1 engine foundation).
  | "assignment.failed"
  | "assignment.job_enqueued"
  | "assignment.job_completed"
  | "assignment.job_retried"
  | "assignment.job_dead_lettered"
  // Phase 4 lifecycle / queue management.
  | "assignment.recovered"
  | "assignment.recycled"
  | "assignment.rebalanced"
  | "assignment.dead_letter_retried"
  // Phase 5 skills / SLA routing.
  | "assignment.sla_escalated"
  | "assignment.skill_fallback"
  | "assignment.schedule_skipped"
  | "supervisor.force_assigned"
  | "supervisor.force_recycled";

// Phase 10 — latency timings, kept separate from the counters above. Each name
// tracks count/sum/min/max plus a bounded ring of recent samples so a p50/p95
// can be estimated without storing unbounded history (same "point-in-time since
// last restart" caveat as the counters — a real metrics backend is the durable
// path, and every call site here stays the same when that arrives).
export type TimingName =
  | "assignment.decision_ms"
  | "ingest.lead_ms"
  | "insights.recompute_ms"
  | "queue.reserve_ms"
  | "capi.send_ms"
  | "db.ping_ms";

export interface TimingSummary {
  count: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface Metrics {
  increment(name: MetricName, by?: number): void;
  snapshot(): Record<MetricName, number>;
  // Additive (Phase 10): record a latency sample and read back summaries.
  recordTiming(name: TimingName, ms: number): void;
  timingSummary(name: TimingName): TimingSummary;
  timingSnapshot(): Record<TimingName, TimingSummary>;
}

const ALL_METRIC_NAMES: MetricName[] = [
  "http.auth_failure",
  "http.permission_failure",
  "http.validation_failure",
  "http.slow_request",
  "db.slow_query",
  "job.completed",
  "job.failed",
  "job.dead_lettered",
  "notification.failed",
  "rate_limit.exceeded",
  "ai.request",
  "ai.success",
  "ai.failure",
  "ai.fallback_used",
  "presence.heartbeat_lost",
  "presence.heartbeat_received",
  "presence.heartbeat_restored",
  "presence.reconnect",
  "presence.missed_beat",
  "presence.state_transition",
  "assignment.filtered_offline",
  "assignment.filtered_workload",
  "assignment.overflow_used",
  "assignment.unassigned_no_agents",
  "assignment.skipped_blacklisted",
  "assignment.assigned",
  "assignment.claim_lost",
  "assignment.queue_drained",
  "assignment.failed",
  "assignment.job_enqueued",
  "assignment.job_completed",
  "assignment.job_retried",
  "assignment.job_dead_lettered",
  "assignment.recovered",
  "assignment.recycled",
  "assignment.rebalanced",
  "assignment.dead_letter_retried",
  "assignment.sla_escalated",
  "assignment.skill_fallback",
  "assignment.schedule_skipped",
  "supervisor.force_assigned",
  "supervisor.force_recycled",
];

const ALL_TIMING_NAMES: TimingName[] = ["assignment.decision_ms", "ingest.lead_ms", "insights.recompute_ms", "queue.reserve_ms", "capi.send_ms", "db.ping_ms"];
const TIMING_RING_SIZE = 512; // recent samples kept per name for percentile estimation

type TimingState = { count: number; sum: number; min: number; max: number; ring: number[]; ringPos: number };

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

class InMemoryMetrics implements Metrics {
  private counts = new Map<MetricName, number>(ALL_METRIC_NAMES.map((name) => [name, 0]));
  private timings = new Map<TimingName, TimingState>();

  increment(name: MetricName, by: number = 1): void {
    this.counts.set(name, (this.counts.get(name) || 0) + by);
  }

  snapshot(): Record<MetricName, number> {
    const result = {} as Record<MetricName, number>;
    for (const name of ALL_METRIC_NAMES) {
      result[name] = this.counts.get(name) || 0;
    }
    return result;
  }

  recordTiming(name: TimingName, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    let s = this.timings.get(name);
    if (!s) {
      s = { count: 0, sum: 0, min: ms, max: ms, ring: [], ringPos: 0 };
      this.timings.set(name, s);
    }
    s.count++;
    s.sum += ms;
    if (ms < s.min) s.min = ms;
    if (ms > s.max) s.max = ms;
    // Bounded ring buffer of recent samples for percentile estimation.
    if (s.ring.length < TIMING_RING_SIZE) s.ring.push(ms);
    else {
      s.ring[s.ringPos] = ms;
      s.ringPos = (s.ringPos + 1) % TIMING_RING_SIZE;
    }
  }

  timingSummary(name: TimingName): TimingSummary {
    const s = this.timings.get(name);
    if (!s || s.count === 0) return { count: 0, avgMs: null, p50Ms: null, p95Ms: null, maxMs: null };
    const sorted = [...s.ring].sort((a, b) => a - b);
    return {
      count: s.count,
      avgMs: Math.round(s.sum / s.count),
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: Math.round(s.max),
    };
  }

  timingSnapshot(): Record<TimingName, TimingSummary> {
    const result = {} as Record<TimingName, TimingSummary>;
    for (const name of ALL_TIMING_NAMES) result[name] = this.timingSummary(name);
    return result;
  }
}

export const metrics: Metrics = new InMemoryMetrics();
