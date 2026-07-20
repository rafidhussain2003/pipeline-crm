// Stabilization Phase 3 — recognising database constraint violations.
//
// Drizzle wraps the driver error, so the Postgres detail (which names the
// constraint that was violated) is on `err.cause`, NOT on `err.message` —
// checking only the top-level message silently never matches, and the caller
// falls through to a 500 for what is really a 409.

/** True when `err` means the database schema is BEHIND the running code —
 * a migration that shipped with this build has not been applied yet:
 *   42703 undefined_column   (e.g. users.current_session_id, 0038)
 *   42P01 undefined_table    (e.g. trusted_devices, 0038)
 *   22P02 invalid enum input (e.g. verification_purpose 'device_otp', 0038)
 * Auth-critical routes use this to degrade gracefully (with loud logs)
 * instead of hard-failing every login until the boot migrator
 * (src/instrumentation.ts) lands the schema. */
export function isSchemaLagError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const cause = (err as { cause?: unknown }).cause;
  const code = (cause as { code?: string } | undefined)?.code ?? (err as { code?: string }).code;
  if (code === "42703" || code === "42P01") return true;
  const top = err instanceof Error ? err.message : "";
  const causeMsg = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const text = `${top} ${causeMsg}`;
  if (code === "22P02") return text.includes("invalid input value for enum");
  return (text.includes("column") || text.includes("relation")) && text.includes("does not exist");
}

/** True when `err` is Postgres 42703 (undefined_column) — the running code
 * references a column the database doesn't have yet, i.e. a migration that
 * shipped with this build has not been applied. Used by routes that can
 * degrade gracefully instead of answering 500 until migrations land. */
export function isUndefinedColumn(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const cause = (err as { cause?: unknown }).cause;
  const code = (cause as { code?: string } | undefined)?.code ?? (err as { code?: string }).code;
  const top = err instanceof Error ? err.message : "";
  const causeMsg = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const text = `${top} ${causeMsg}`;
  return code === "42703" || (text.includes("column") && text.includes("does not exist"));
}

/** True when `err` is a unique-constraint violation for the named index. */
export function isUniqueViolation(err: unknown, constraintName: string): boolean {
  if (!err || typeof err !== "object") return false;
  const top = err instanceof Error ? err.message : "";
  const cause = (err as { cause?: unknown }).cause;
  const causeMsg = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const code = (cause as { code?: string } | undefined)?.code ?? (err as { code?: string }).code;
  const text = `${top} ${causeMsg}`;
  // 23505 = unique_violation. Match on the constraint name so a violation of a
  // DIFFERENT constraint on the same table is never mistaken for this one.
  return (code === "23505" || text.includes("duplicate key")) && text.includes(constraintName);
}
