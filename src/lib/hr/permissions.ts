// Phase 22 — HR permission architecture.
//
//   hr:view_own  — an employee sees their OWN profile
//   hr:view      — the directory, departments, org chart, dashboard
//   hr:manage    — CRUD employees, departments, designations, types, documents
//   hr:admin     — module settings
//
// Today: admin = everything; manager = view (the directory + org chart, no
// edits); agent = own profile only. FUTURE ROLES: a dedicated "hr_manager"
// role (role-enum migration) gets a row here granting manage — no route
// changes. Platform Owner controls the FEATURE, not company HR data.
import type { Role } from "@/lib/permissions";

export type HRPermission = "hr:view_own" | "hr:view" | "hr:manage" | "hr:admin";

const HR_ROLE_PERMISSIONS: Record<Role, ReadonlySet<HRPermission>> = {
  super_admin: new Set(),
  admin: new Set(["hr:view_own", "hr:view", "hr:manage", "hr:admin"]),
  manager: new Set(["hr:view_own", "hr:view"]),
  agent: new Set(["hr:view_own"]),
};

export function hasHRPermission(role: Role, permission: HRPermission): boolean {
  return HR_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
