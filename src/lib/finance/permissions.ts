// Phase 19 — Finance permission architecture.
//
// Three capabilities, resolved from the platform role:
//   finance:view    — see dashboards, accounts, ledger, documents
//   finance:post    — record revenue/expenses, create + post journal entries
//   finance:manage  — chart of accounts, years, opening balances, voids, settings
//
// Today: admin = manage+post+view, manager = post+view, agent = nothing.
// FUTURE FINANCE ROLES: this map is deliberately the ONE place finance
// authorization lives. When a dedicated "finance_manager" role lands (a
// role-enum migration), it gets a row here — no route changes. The same seam
// serves any later per-user finance grant (store a flag, consult it here).
import type { Role } from "@/lib/permissions";

export type FinancePermission = "finance:view" | "finance:post" | "finance:manage";

const FINANCE_ROLE_PERMISSIONS: Record<Role, ReadonlySet<FinancePermission>> = {
  super_admin: new Set(), // platform owner manages FEATURES, not company books (no companyId)
  admin: new Set(["finance:view", "finance:post", "finance:manage"]),
  manager: new Set(["finance:view", "finance:post"]),
  agent: new Set(),
};

export function hasFinancePermission(role: Role, permission: FinancePermission): boolean {
  return FINANCE_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
