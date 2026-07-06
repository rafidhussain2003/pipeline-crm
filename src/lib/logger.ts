// Minimal structured (JSON-line) logger. No external dependency: Render's
// log stream just captures stdout/stderr, and a JSON line per event is
// enough to search/filter without needing a logging service integration
// yet. If/when this grows past what plain JSON lines can do (log shipping,
// sampling, redaction rules), swap the internals of `emit()` for pino —
// every call site here goes through `createLogger()`, so nothing else in
// the app needs to change.
type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context: LogContext) {
  const line = JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    ...context,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug: (message: string, extra?: LogContext) => void;
  info: (message: string, extra?: LogContext) => void;
  warn: (message: string, extra?: LogContext) => void;
  error: (message: string, extra?: LogContext) => void;
  // Merges into this logger's bound context permanently — e.g. once a route
  // resolves the session, it can call `logger.setContext({ userId, companyId })`
  // so every subsequent line (including withRoute's own final summary line)
  // includes it, without every log call needing to repeat it.
  setContext: (extra: LogContext) => void;
};

// `context` (e.g. { requestId, route }) is attached to every line logged
// through the returned logger, so a single request's log lines can be
// grepped/filtered together in the Render log stream.
export function createLogger(context: LogContext = {}): Logger {
  const ctx: LogContext = { ...context };
  return {
    debug: (message, extra) => emit("debug", message, { ...ctx, ...extra }),
    info: (message, extra) => emit("info", message, { ...ctx, ...extra }),
    warn: (message, extra) => emit("warn", message, { ...ctx, ...extra }),
    error: (message, extra) => emit("error", message, { ...ctx, ...extra }),
    setContext: (extra) => Object.assign(ctx, extra),
  };
}
