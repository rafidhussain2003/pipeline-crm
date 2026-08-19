// Finance permission architecture.
//
// TWO layers, resolved together:
//
//   Coarse (unchanged vocabulary the routes already speak):
//     finance:view    — see dashboards, accounts, ledger, documents
//     finance:post    — record revenue/expenses, create + post journal entries
//     finance:manage  — chart of accounts, years, opening balances, voids, settings
//
//   Fine, per-person capabilities (Finance Employees): the admin's toggles.
//     record_expense · record_payout · record_income · view_balances ·
//     view_reports · manage
//
// The coarse permission is DERIVED from the capability set, so both stay in
// sync and every existing role behaves exactly as before:
//   admin           → every capability (view+post+manage)
//   manager         → everything except manage (view+post) — unchanged
//   finance_employee→ the per-user set stored on users.finance_capabilities
//   agent/others    → nothing, UNLESS the admin granted them the Finance
//                     module (Enterprise Workspaces), which opens view+post —
//                     exactly the pre-existing "granted" behavior.
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { isSchemaLagError } from "@/lib/db-errors";
import { resolveModuleOverride } from "@/lib/module-access";
import type { Role } from "@/lib/permissions";

export type FinancePermission = "finance:view" | "finance:post" | "finance:manage";

// The fine-grained capabilities an admin toggles per Finance Employee.
export const FINANCE_CAPABILITIES = [
  "record_expense", // business expenses & salary payments (money out)
  "record_payout", // customer payouts (money out)
  "record_income", // client payments / other income (money in)
  "view_balances", // cash/bank/asset/investment funds & dashboard totals
  "view_reports", // general ledger, journal entries, accounts, reports
  "manage", // chart of accounts, years, currency, opening balances, voids, investments
] as const;
export type FinanceCapability = (typeof FINANCE_CAPABILITIES)[number];

export function isFinanceCapability(key: string): key is FinanceCapability {
  return (FINANCE_CAPABILITIES as readonly string[]).includes(key);
}

// The full member set (everything except `manage`) — what a manager has today,
// and what an Enterprise-Workspaces "finance" grant opens for another role.
const MEMBER_CAPS: readonly FinanceCapability[] = ["record_expense", "record_payout", "record_income", "view_balances", "view_reports"];

// Roles whose finance capabilities are FIXED (not per-user).
const FIXED_ROLE_CAPS: Partial<Record<Role, readonly FinanceCapability[]>> = {
  admin: FINANCE_CAPABILITIES,
  manager: MEMBER_CAPS,
};

const TTL = 30_000;
const cacheKey = (userId: string) => `finance-caps:${userId}`;

// The per-user stored set (finance_employee). Cache + schema-lag guard mirror
// module-access exactly: a missing column behaves as "no capabilities", never
// a 500, and self-heals once the boot migrator lands migration 0049.
async function storedCapabilities(userId: string): Promise<FinanceCapability[]> {
  try {
    return await cache.getOrSet(cacheKey(userId), TTL, async () => {
      const [row] = await db.select({ c: users.financeCapabilities }).from(users).where(eq(users.id, userId)).limit(1);
      const raw = row?.c;
      const out: FinanceCapability[] = [];
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (v === true && isFinanceCapability(k)) out.push(k);
        }
      }
      return out;
    });
  } catch (err) {
    if (!isSchemaLagError(err)) throw err;
    console.error("[finance-permissions] finance_capabilities column missing — migration 0049 not applied yet; treating as none");
    return [];
  }
}

// The effective capability set for a user. The ONE place finance authorization
// is decided; the guard and the fine per-action checks both read it.
export async function resolveFinanceCapabilities(userId: string, role: Role): Promise<Set<FinanceCapability>> {
  const fixed = FIXED_ROLE_CAPS[role];
  if (fixed) return new Set(fixed);
  if (role === "finance_employee") return new Set(await storedCapabilities(userId));
  // Any other role has finance access only via an explicit module grant, which
  // opens the member set (view+post) — never manage. (Deny/no-grant → nothing.)
  const override = await resolveModuleOverride(userId, role, "finance");
  return override === "granted" ? new Set(MEMBER_CAPS) : new Set();
}

// Derive the coarse permission the routes ask for from a capability set.
export function coarseFromCapabilities(caps: ReadonlySet<FinanceCapability>): Set<FinancePermission> {
  const out = new Set<FinancePermission>();
  if (caps.size > 0) out.add("finance:view");
  if (caps.has("record_expense") || caps.has("record_payout") || caps.has("record_income")) out.add("finance:post");
  if (caps.has("manage")) out.add("finance:manage");
  return out;
}

export function invalidateFinanceCapabilities(userId: string): Promise<void> {
  return cache.delete(cacheKey(userId));
}

// Coerce an arbitrary input (an admin's checkbox state) into a clean, complete
// capability object with every key present as a boolean — what gets stored on
// users.finance_capabilities. Unknown keys are dropped; missing keys are false.
export function normalizeFinanceCapabilities(input: unknown): Record<FinanceCapability, boolean> {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out = {} as Record<FinanceCapability, boolean>;
  for (const cap of FINANCE_CAPABILITIES) out[cap] = obj[cap] === true;
  return out;
}

// Legacy coarse-only helper (kept for callers that only need the static role
// default). Prefer resolveFinanceCapabilities for anything per-user.
const FINANCE_ROLE_PERMISSIONS: Record<Role, ReadonlySet<FinancePermission>> = {
  super_admin: new Set(),
  admin: new Set(["finance:view", "finance:post", "finance:manage"]),
  manager: new Set(["finance:view", "finance:post"]),
  agent: new Set(),
  lead_distributor: new Set(),
  finance_employee: new Set(), // per-user — resolved via resolveFinanceCapabilities
  hr_employee: new Set(), // HR workspace only — no Finance access
  hr_record: new Set(), // personnel record only — no access
};

export function hasFinancePermission(role: Role, permission: FinancePermission): boolean {
  return FINANCE_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
