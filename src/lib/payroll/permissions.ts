// Phase 21 — Payroll permission architecture.
//
//   payroll:view_own   — see your OWN payslips (every employee)
//   payroll:view       — see everyone's payroll, dashboard, registers
//   payroll:manage     — structures, profiles, runs, calculate, adjustments
//   payroll:approve    — approve/pay runs (the money-moving actions)
//   payroll:admin      — module settings
//
// Today: admin = everything; manager = view/manage but NOT approve or admin
// (a Payroll Manager approves; today only the Company Admin does — matching the
// spec's role list where Payroll Manager is a placeholder); agents view own
// payslips only. FUTURE ROLES: a dedicated "payroll_manager" role (role-enum
// migration) gets a row here granting approve — no route changes anywhere.
import type { Role } from "@/lib/permissions";

export type PayrollPermission = "payroll:view_own" | "payroll:view" | "payroll:manage" | "payroll:approve" | "payroll:admin";

const PAYROLL_ROLE_PERMISSIONS: Record<Role, ReadonlySet<PayrollPermission>> = {
  super_admin: new Set(),
  admin: new Set(["payroll:view_own", "payroll:view", "payroll:manage", "payroll:approve", "payroll:admin"]),
  manager: new Set(["payroll:view_own", "payroll:view", "payroll:manage"]),
  agent: new Set(["payroll:view_own"]),
};

export function hasPayrollPermission(role: Role, permission: PayrollPermission): boolean {
  return PAYROLL_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
