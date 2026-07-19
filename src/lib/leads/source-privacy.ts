// Phase 3 — Lead Privacy Layer.
//
// A source's real name is marketing intelligence: "$99 Bundle July",
// "High Credit Campaign". Admins need it for reporting; agents do not need it
// and it should not travel with them. This module is the ONE place that decides
// which name a given role sees, so a new surface cannot accidentally invent its
// own rule and leak the real one.
//
// Design notes:
//   - The alias is stored ALONGSIDE the real name, never over it. Reporting
//     accuracy is preserved by construction — nothing is destructive.
//   - No lead row is touched: a lead already points at its source, so the alias
//     resolves through that existing relationship. Copying names onto 6.7k lead
//     rows would have created a second source of truth that drifts.
//   - Resolution is pure string work on rows the caller already fetched, so it
//     adds no query and no join. Nothing here can cause an N+1.

/** Roles that are entitled to the true, internal name. */
export type PrivacyRole = "super_admin" | "admin" | "manager" | "agent" | string | null | undefined;

// Managers run reporting and campaign analysis, so they see real names.
// Everyone else — agents today, any future non-privileged role — sees the alias.
const ROLES_SEEING_ACTUAL_NAME = new Set(["super_admin", "admin", "manager"]);

export function canSeeActualSourceName(role: PrivacyRole): boolean {
  return typeof role === "string" && ROLES_SEEING_ACTUAL_NAME.has(role);
}

/**
 * The name to render for `role`.
 *
 * Privileged roles get the actual name. Everyone else gets the alias, falling
 * back to the actual name when no alias is set — an unaliased source must still
 * be identifiable, and showing a blank or "Unknown" would make an agent's list
 * useless. Task 3 defines exactly this fallback.
 */
export function resolveSourceName(
  role: PrivacyRole,
  actualName: string | null | undefined,
  agentDisplayName: string | null | undefined
): string | null {
  const actual = actualName?.trim() || null;
  const alias = agentDisplayName?.trim() || null;
  if (canSeeActualSourceName(role)) return actual;
  return alias ?? actual;
}

/**
 * Admin-facing shape: both names, so the settings UI can show the real one
 * read-only next to the editable alias without a second query.
 */
export function sourceNamesForAdmin(
  actualName: string | null | undefined,
  agentDisplayName: string | null | undefined
): { actualName: string | null; agentDisplayName: string | null; effectiveForAgents: string | null } {
  const actual = actualName?.trim() || null;
  const alias = agentDisplayName?.trim() || null;
  return { actualName: actual, agentDisplayName: alias, effectiveForAgents: alias ?? actual };
}
