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
  | "assignment.filtered_offline"
  | "assignment.filtered_workload"
  | "assignment.overflow_used"
  | "assignment.unassigned_no_agents"
  | "assignment.skipped_blacklisted"
  | "supervisor.force_assigned"
  | "supervisor.force_recycled";

export interface Metrics {
  increment(name: MetricName, by?: number): void;
  snapshot(): Record<MetricName, number>;
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
  "assignment.filtered_offline",
  "assignment.filtered_workload",
  "assignment.overflow_used",
  "assignment.unassigned_no_agents",
  "assignment.skipped_blacklisted",
  "supervisor.force_assigned",
  "supervisor.force_recycled",
];

class InMemoryMetrics implements Metrics {
  private counts = new Map<MetricName, number>(ALL_METRIC_NAMES.map((name) => [name, 0]));

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
}

export const metrics: Metrics = new InMemoryMetrics();
