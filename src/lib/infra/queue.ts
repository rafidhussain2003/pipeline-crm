// Job queue abstraction. This is the seam where "run this later, off the
// request, with retries" gets introduced without touching call sites again
// once Redis/BullMQ (or similar) is actually provisioned.
//
// Today's implementation (`InProcessQueue`) runs the handler immediately,
// inline, awaited — i.e. IDENTICAL behavior to calling the function
// directly. Nothing is actually deferred yet; this is intentional (Redis
// isn't provisioned and this phase explicitly says not to implement real
// queues yet). What this buys us now:
//   - one place that knows about every background-work "job type" in the
//     app, instead of that knowledge being implicit in whichever function
//     a route happens to call directly
//   - handlers are plain `(payload) => Promise<void>` functions with no
//     dependency on NextRequest/NextResponse, so they can be lifted into a
//     real worker process later without rewriting them
//   - a single retry/attempts/dead-letter policy shape, ready to matter
//     once jobs actually run asynchronously
//
// Swapping in a real queue later means writing one new `JobQueue`
// implementation (e.g. BullMQ-backed) — call sites (`queue.enqueue(...)`)
// do not change.
import { createLogger } from "../logger";
import { metrics } from "./metrics";

export type JobType =
  | "lead.assign"
  | "facebook.process_lead"
  | "leads.import"
  | "leads.export"
  | "automation.recycle"
  | "webhook.retry"
  | "email.send" // reserved: no email-sending feature exists yet
  | "audit.record"
  | "report.generate"; // reserved: no reporting feature exists yet

export type JobPayloads = {
  "lead.assign": { leadId: string; companyId: string; requiredSkillId?: string | null; excludeAgentId?: string | null };
  "facebook.process_lead": { leadgenId: string; pageId: string };
  "leads.import": { companyId: string; csv: string };
  "leads.export": { companyId: string };
  "automation.recycle": { companyId: string };
  "webhook.retry": { webhookLogId: string };
  "email.send": { to: string; template: string; data: Record<string, unknown> };
  "audit.record": { companyId: string | null; userId: string | null; action: string; entityType: string; entityId?: string | null };
  "report.generate": { companyId: string; reportType: string };
};

export type JobHandler<T extends JobType> = (payload: JobPayloads[T]) => Promise<void>;

export interface JobQueue {
  register<T extends JobType>(type: T, handler: JobHandler<T>): void;
  enqueue<T extends JobType>(type: T, payload: JobPayloads[T]): Promise<void>;
}

const MAX_ATTEMPTS = 3;

class InProcessQueue implements JobQueue {
  private handlers = new Map<JobType, JobHandler<never>>();
  private logger = createLogger({ component: "queue" });

  register<T extends JobType>(type: T, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler<never>);
  }

  async enqueue<T extends JobType>(type: T, payload: JobPayloads[T]): Promise<void> {
    const handler = this.handlers.get(type);
    if (!handler) {
      this.logger.error("no_handler_registered", { jobType: type });
      throw new Error(`No handler registered for job type "${type}"`);
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        await handler(payload as never);
        this.logger.info("job_completed", { jobType: type, attempt, durationMs: Date.now() - startedAt });
        metrics.increment("job.completed");
        return;
      } catch (err) {
        lastErr = err;
        this.logger.warn("job_attempt_failed", {
          jobType: type,
          attempt,
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Dead-letter: all attempts exhausted. There's no separate dead-letter
    // store yet (that's a Redis-backed queue's job) — for now this just
    // logs loudly and re-throws, so the caller's own error handling
    // decides what happens next (exactly like calling the function
    // directly would have on a single failure today).
    this.logger.error("job_dead_lettered", {
      jobType: type,
      attempts: MAX_ATTEMPTS,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
    metrics.increment("job.failed");
    metrics.increment("job.dead_lettered");
    throw lastErr;
  }
}

export const queue: JobQueue = new InProcessQueue();
