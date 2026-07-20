import { NextResponse } from "next/server";
import { getSession, requireCompanySession, type CompanySession, type SessionPayload } from "./auth";

// Centralizes "which role can do what" in one place instead of scattering
// `session.role !== "admin"` checks across every route. Adding a role
// later (the schema's role enum is super_admin/admin/manager/agent — see
// schema.ts for why there's no separate "owner" value) means adding one
// entry here, not hunting through every route file.
//
// This intentionally mirrors the EXACT authorization behavior already
// present in the routes it's applied to (verified by reading each route
// before wiring this in) — it's a faithful extraction, not a new policy.
export type Role = SessionPayload["role"];

export type Permission =
  | "assignment_rules:edit"
  | "automation_settings:edit"
  | "tags:manage"
  | "agents:manage" // Agents module: create/edit/reset-password/enable-disable/delete agents
  | "leads:supervise" // force assign/reassign/recycle, lock/unlock agents (Team dashboard)
  | "leads:assign" // manually assign/reassign leads (leads page bulk bar, Lead Workspace)
  | "callbacks:supervise" // see/act on the whole company's callbacks, not just your own
  | "company_settings:edit" // Profile > Company tab
  | "billing:manage" // Subscription page actions (checkout, portal)
  | "companies:manage"; // super-admin-only actions

// Deliberately does NOT grant company-scoped permissions to super_admin:
// super_admin accounts have companyId = null by convention, so
// requirePermission() (which requires a company session) would already
// reject them before this matrix is even consulted. Their power lives
// entirely in the super-admin-only routes guarded by requireSuperAdmin().
//
// manager gets exactly what the Agents module spec asks for — Leads
// (already unrestricted for every company role, nothing to grant) and
// Agents (agents:manage) — but not company-wide settings, API keys, the
// audit log, or integrations, which stay admin-only.
//
// callbacks:supervise is deliberately SEPARATE from leads:supervise rather
// than widening the latter to manager. A manager must see and act on the whole
// company's callbacks (they're the escalation target for a missed one), but
// leads:supervise also carries the Team dashboard's force-assign/recycle and
// agent lock/unlock powers — granting those as a side effect of the callback
// feature would be an unrelated, invisible expansion of what a manager can do.
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set(["companies:manage"]),
  admin: new Set([
    "assignment_rules:edit",
    "automation_settings:edit",
    "tags:manage",
    "agents:manage",
    "leads:supervise",
    "leads:assign",
    "callbacks:supervise",
    "company_settings:edit",
    "billing:manage",
  ]),
  // leads:assign is deliberately SEPARATE from leads:supervise: the Lead
  // Workspace spec gives managers manual assignment, but leads:supervise also
  // carries the Team dashboard's force-recycle and agent lock/unlock powers —
  // granting those as a side effect of an Assign button would be an unrelated,
  // invisible expansion of what a manager can do (same reasoning as
  // callbacks:supervise above).
  manager: new Set(["agents:manage", "callbacks:supervise", "leads:assign"]),
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
