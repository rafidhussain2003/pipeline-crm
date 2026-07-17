// Phase 20 — Attendance permission architecture.
//
//   attendance:self    — check in/out, breaks, request leave, see own history
//   attendance:view    — see everyone's dashboard, records, logs
//   attendance:manage  — shifts, holidays, leave decisions, manual adjustments
//   attendance:admin   — module settings
//
// Today: every company role can attend (self); admin+manager run the module;
// settings are admin-only. FUTURE ROLES: this map is the ONE place attendance
// authorization lives — a dedicated "attendance_manager" role (role-enum
// migration) becomes a row here, no route changes. Platform Owner controls
// the FEATURE, not company attendance (no companyId).
import type { Role } from "@/lib/permissions";

export type AttendancePermission = "attendance:self" | "attendance:view" | "attendance:manage" | "attendance:admin";

const ATTENDANCE_ROLE_PERMISSIONS: Record<Role, ReadonlySet<AttendancePermission>> = {
  super_admin: new Set(),
  admin: new Set(["attendance:self", "attendance:view", "attendance:manage", "attendance:admin"]),
  manager: new Set(["attendance:self", "attendance:view", "attendance:manage"]),
  agent: new Set(["attendance:self"]),
};

export function hasAttendancePermission(role: Role, permission: AttendancePermission): boolean {
  return ATTENDANCE_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
