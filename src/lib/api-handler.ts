import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createLogger, type Logger } from "./logger";
import { getClientIp } from "./rate-limit";
import { metrics } from "./infra/metrics";

const SLOW_REQUEST_MS = 1000;
const SLOW_QUERY_MS = 200;

// Wraps a route handler's body with: a per-request id, client IP, route
// name, and method attached to every log line; structured start/end logs
// (including execution time and HTTP status); automatic classification of
// 401/403/400 responses as auth/permission/validation failures and slow
// responses as their own log line; and a catch-all that guarantees a clean
// JSON response (400 for a malformed body via SyntaxError, 500 for
// anything else) instead of an unhandled exception reaching the client.
//
// Deliberately does NOT replace the exported GET/POST/etc. function's own
// signature — every route still declares `params` etc. exactly like
// before; this only wraps the body, so it can't interact badly with
// Next.js's generated route-handler type checking.
//
// Usage:
//   export async function GET(req: NextRequest) {
//     return withRoute("tags", "GET", req, async (logger) => {
//       ...existing handler body, using `logger` instead of console.log...
//     });
//   }
export async function withRoute(
  routeName: string,
  method: string,
  req: NextRequest,
  fn: (logger: Logger, requestId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  const requestId = randomUUID();
  const logger = createLogger({ requestId, route: routeName, method, ip: getClientIp(req) });
  const startedAt = Date.now();
  logger.info("request_start");
  try {
    const res = await fn(logger, requestId);
    const durationMs = Date.now() - startedAt;
    const status = res.status;
    logger.info("request_end", { status, durationMs });
    if (durationMs > SLOW_REQUEST_MS) {
      logger.warn("slow_request", { status, durationMs });
      metrics.increment("http.slow_request");
    }
    if (status === 401) {
      logger.warn("auth_failure", { status, durationMs });
      metrics.increment("http.auth_failure");
    } else if (status === 403) {
      logger.warn("permission_failure", { status, durationMs });
      metrics.increment("http.permission_failure");
    } else if (status === 400) {
      logger.warn("validation_failure", { status, durationMs });
      metrics.increment("http.validation_failure");
    } else if (status === 429) {
      metrics.increment("rate_limit.exceeded");
    }
    return res;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (err instanceof SyntaxError) {
      logger.warn("invalid_json_body", { durationMs });
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    logger.error("unhandled_error", {
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    });
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}

// Optional helper for timing an individual DB call (or any awaited
// operation) "where practical" per request, without requiring every route
// to adopt it at once. Logs at debug level so it doesn't add noise unless
// something is actually inspecting these lines.
export async function timed<T>(logger: Logger, label: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    logger.debug("db_timing", { label, durationMs });
    if (durationMs > SLOW_QUERY_MS) {
      logger.warn("slow_query", { label, durationMs });
      metrics.increment("db.slow_query");
    }
    return result;
  } catch (err) {
    logger.debug("db_timing", { label, durationMs: Date.now() - startedAt, failed: true });
    throw err;
  }
}
