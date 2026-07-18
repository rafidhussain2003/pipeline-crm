// Stabilization Phase 3 — recognising database constraint violations.
//
// Drizzle wraps the driver error, so the Postgres detail (which names the
// constraint that was violated) is on `err.cause`, NOT on `err.message` —
// checking only the top-level message silently never matches, and the caller
// falls through to a 500 for what is really a 409.

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
