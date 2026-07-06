import { NextResponse } from "next/server";
import { getSession, requireCompanySession, type CompanySession, type SessionPayload } from "./auth";

// Centralizes "which role can do what" in one place instead of scattering
// `session.role !== "admin"` checks across every route. Adding a role later
// (the app currently only has super_admin/admin/agent — "Owner"/"Manager"
// don't exist in the schema's role enum yet) means adding one entry here,
// not hunting through every route file.
//
// This intentionally mirrors the EXACT authorization behavior already
// present in the routes it's applied to (verified by reading each route
// before wiring this in) — it's a faithful extraction, not a new policy.
export type Role = SessionPayload["role"];

export type Permission =
  | "assignment_rules:edit"
  | "automation_settings:edit"
  | "tags:manage"
  | "users:create"
  | "leads:supervise" // force assign/reassign/recycle, lock/unlock agents (Team dashboard)
  | "companies:manage"; // super-admin-only actions

// Deliberately does NOT grant company-scoped permissions to super_admin:
// super_admin accounts have companyId = null by convention, so
// requirePermission() (which requires a company session) would already
// reject them before this matrix is even consulted. Their power lives
// entirely in the super-admin-only routes guarded by requireSuperAdmin().
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set(["companies:manage"]),
  admin: new Set(["assignment_rules:edit", "automation_settings:edit", "tags:manage", "users:create", "leads:supervise"]),
  agent: new Set(["tags:manage"]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

type AuthResult = { ok: true; session: CompanySession } | { ok: false; response: NextResponse };

// Declares, at the call site, exactly what a route requires: an active
// company session (tenant validation) AND a specific permission.
//   const auth = await requirePermission("assignment_rules:edit");
//   if (!auth.ok) return auth.response;
export async function requirePermission(permission: Permission): Promise<AuthResult> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!hasPermission(auth.session.role, permission)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return auth;
}

// Super-admin routes aren't company-scoped (super_admin has no companyId),
// so they need their own guard rather than requirePermission(). This
// replaces the identical `requireSuperAdmin` helper that was previously
// duplicated locally in two super-admin route files.
export async function requireSuperAdmin(): Promise<
  { ok: true; session: SessionPayload } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session || session.role !== "super_admin") {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) };
  }
  return { ok: true, session };
}
