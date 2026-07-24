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

// ---------------------------------------------------------------------------
// FACEBOOK FORM names — a STRICTER rule than source (page) names above.
//
// A Facebook Lead FORM name ("AT&T Fiber Texas Campaign") is campaign
// intelligence the business does not want agents OR managers to see; only the
// Platform Owner and the company Admin may. This deliberately differs from the
// source/page rule, where managers DO see the real name for reporting — hence
// a separate resolver instead of reusing resolveSourceName. The two must not
// be conflated: changing one must never silently change the other.
//
// The security-critical property: for manager/agent this function can NEVER
// return the actual form name — not even as a fallback when no display name is
// set. An unaliased form falls back to a GENERIC label, never the real one.
// Existing forms are backfilled (display name := form name) so this generic
// fallback is only ever hit by a brand-new form before an admin names it.
// ---------------------------------------------------------------------------

const ROLES_SEEING_ACTUAL_FORM_NAME = new Set(["super_admin", "admin"]);

/** Only the Platform Owner and company Admin may see a form's REAL name. */
export function canSeeActualFormName(role: PrivacyRole): boolean {
  return typeof role === "string" && ROLES_SEEING_ACTUAL_FORM_NAME.has(role);
}

// Shown to manager/agent when a form has no display name yet (a new form an
// admin hasn't labelled). Deliberately NOT the actual form name.
export const GENERIC_FORM_LABEL = "Facebook Lead Form";

/**
 * The form name to render for `role`.
 *   - Platform Owner / Admin → the actual form name.
 *   - Manager / Agent → the display name, or the generic label if unset.
 *     NEVER the actual name.
 */
export function resolveFormName(
  role: PrivacyRole,
  actualFormName: string | null | undefined,
  displayName: string | null | undefined
): string {
  const actual = actualFormName?.trim() || null;
  const display = displayName?.trim() || null;
  if (canSeeActualFormName(role)) return actual ?? GENERIC_FORM_LABEL;
  return display ?? GENERIC_FORM_LABEL;
}

/**
 * The name shown in the Form COLUMN / lead detail — the DISPLAY NAME (alias)
 * for EVERYONE, admins included. This is the correction to the earlier
 * behavior where admins saw the actual name in the column: admins see the
 * alias here too (the actual name is exposed separately, admin-only, for a
 * tooltip). Falls back only when no alias is set (a brand-new form before an
 * admin names it): admins may fall back to the actual name, but managers and
 * agents fall back to the generic label — NEVER the actual name.
 */
export function resolveFormDisplayName(
  role: PrivacyRole,
  actualFormName: string | null | undefined,
  displayName: string | null | undefined
): string {
  const display = displayName?.trim() || null;
  if (display) return display;
  return canSeeActualFormName(role) ? actualFormName?.trim() || GENERIC_FORM_LABEL : GENERIC_FORM_LABEL;
}
