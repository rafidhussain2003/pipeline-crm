// The route guards for Finance: session + feature entitlement (Platform
// Feature Management) + finance authorization, in that order.
//
//   const auth = await requireFinance("finance:view");        // coarse
//   const auth = await requireFinanceCapability("view_balances"); // fine
//   if (!auth.ok) return auth.response;
//
// Both resolve the caller's effective capability set (see permissions.ts):
// admin/manager derive it from their role exactly as before; a finance_employee
// gets their per-person set; any other role gets it only from an explicit
// Finance module grant. Coarse checks map the set down to view/post/manage;
// fine checks test a single capability (used to gate a specific action or a
// sensitive field, e.g. hiding fund balances).
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";
import { resolveModuleOverride } from "@/lib/module-access";
import {
  resolveFinanceCapabilities,
  coarseFromCapabilities,
  type FinancePermission,
  type FinanceCapability,
} from "./permissions";
import { FinanceError } from "./types";

type Ok = { ok: true; session: CompanySession };
type Fail = { ok: false; response: NextResponse };
const forbidden = (msg = "You do not have access to Finance"): Fail => ({
  ok: false,
  response: NextResponse.json({ error: msg }, { status: 403 }),
});

// Shared preamble: valid company session, feature enabled, module not denied,
// plus the resolved capability set. Every finance authorization flows through
// this so the ordering and the tenant/feature gates are identical everywhere.
async function financeContext(): Promise<
  { ok: true; session: CompanySession; caps: Set<FinanceCapability> } | Fail
> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!(await featureService.isEnabled(auth.session.companyId, "finance"))) {
    return { ok: false, response: NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 }) };
  }
  // Enterprise Workspaces: an explicit "denied" assignment blocks the module
  // outright, before any capability is considered.
  if ((await resolveModuleOverride(auth.session.userId, auth.session.role, "finance")) === "denied") {
    return forbidden();
  }
  const caps = await resolveFinanceCapabilities(auth.session.userId, auth.session.role);
  return { ok: true, session: auth.session, caps };
}

export async function requireFinance(permission: FinancePermission): Promise<Ok | Fail> {
  const ctx = await financeContext();
  if (!ctx.ok) return ctx;
  if (!coarseFromCapabilities(ctx.caps).has(permission)) return forbidden();
  return { ok: true, session: ctx.session };
}

// Gate a specific action/field on ONE capability (record_expense, view_balances,
// …). Used where the coarse view/post/manage buckets are too broad.
export async function requireFinanceCapability(capability: FinanceCapability): Promise<Ok | Fail> {
  const ctx = await financeContext();
  if (!ctx.ok) return ctx;
  if (!ctx.caps.has(capability)) return forbidden();
  return { ok: true, session: ctx.session };
}

// Advanced finance areas — investments and free-form (manual) journal entries.
// Same coarse gate as before for admins, managers and Enterprise-Workspace
// grantees (so their behavior is unchanged), but a Finance Employee needs the
// Manage capability here: their record_* capabilities are meant for the guided
// expense/income/payout forms, NOT arbitrary ledger or investment tooling.
// Without this, an employee granted only "record expenses" could reach these
// routes directly (they map to the coarse finance:post the record capability
// implies) even though the UI never offers them.
export async function requireFinanceAdvanced(permission: FinancePermission): Promise<Ok | Fail> {
  const ctx = await financeContext();
  if (!ctx.ok) return ctx;
  if (!coarseFromCapabilities(ctx.caps).has(permission)) return forbidden();
  if (ctx.session.role === "finance_employee" && !ctx.caps.has("manage")) {
    return forbidden("This action needs the Manage capability.");
  }
  return { ok: true, session: ctx.session };
}

// Read-only helper: the caller's capability set (for routes that must branch on
// a capability, e.g. the dashboard hiding balances, rather than hard-gating).
export async function getFinanceCapabilities(): Promise<
  { ok: true; session: CompanySession; caps: Set<FinanceCapability> } | Fail
> {
  return financeContext();
}

// Managing WHO can touch the books (adding/editing Finance Employees) is more
// sensitive than managing the books, so it is admin-only — NOT opened by the
// `manage` capability. requireFinance gives the session + feature/tenant gates;
// this narrows to a company admin.
export async function requireFinanceAdmin(): Promise<Ok | Fail> {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth;
  if (auth.session.role !== "admin") return forbidden("Only an admin can manage finance employees.");
  return auth;
}

// Uniform FinanceError → JSON mapping so route bodies stay two lines.
export function financeErrorResponse(err: unknown): NextResponse {
  if (err instanceof FinanceError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}
