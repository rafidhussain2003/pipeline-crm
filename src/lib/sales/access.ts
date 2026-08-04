// Sales Ledger — the ONE place authorization + agent visibility is decided.
//
// Role gate: the ledger is a CRM-adjacent tool used by the people who make and
// oversee sales — admin, manager, agent. finance_employee, lead_distributor and
// super_admin have no business here and get a 403 (mirrors how Leads is gated:
// a role check, no per-user module assignment).
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { featureService, FEATURE_DISABLED_MESSAGE } from "@/lib/features";
import { getPeriodSetting } from "./periods";

type Ok = { ok: true; session: CompanySession };
type Fail = { ok: false; response: NextResponse };

export async function requireSales(): Promise<Ok | Fail> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  // Optional module: the Platform Owner must have Sales Ledger enabled for this
  // company. The proxy gates it too; this is the in-route backstop (same pattern
  // as requireFinance) so no /api/sales endpoint can be reached when it's off.
  if (!(await featureService.isEnabled(auth.session.companyId, "sales_ledger"))) {
    return { ok: false, response: NextResponse.json({ error: FEATURE_DISABLED_MESSAGE }, { status: 403 }) };
  }
  const r = auth.session.role;
  if (r !== "admin" && r !== "manager" && r !== "agent") {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to the Sales Ledger." }, { status: 403 }) };
  }
  return auth;
}

// The company-current month, 'YYYY-MM' (server-local, same basis as the rest of
// the app's day/month boundaries).
export function currentSaleMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type SalesScope = {
  // admin + manager see every agent's rows; an agent is hard-scoped to their own.
  viewAll: boolean;
  // agent past the month's cutoff → false: the API returns ONLY summary counts,
  // never rows or PII, and editing is refused.
  canSeeDetail: boolean;
  canEdit: boolean;
  // admin-only: delete/restore, set the month's visibility cutoff.
  canManage: boolean;
  // admin ONLY: export/download the sheet (CSV/Excel) + Print. A bulk export is
  // the whole customer database in one file — the prime data-theft vector — so
  // it is withheld from managers and agents even though they can view the rows.
  canExport: boolean;
};

// Resolve what THIS caller may do with a given month.
export async function resolveSalesScope(session: CompanySession, month: string): Promise<SalesScope> {
  if (session.role === "admin") {
    return { viewAll: true, canSeeDetail: true, canEdit: true, canManage: true, canExport: true };
  }
  if (session.role === "manager") {
    // Supervisor: sees + edits everyone, never subject to the agent cutoff, but
    // no destructive/config powers (delete/restore/visibility) — those are admin
    // — and NO export/download either (bulk data leaves only through an admin).
    return { viewAll: true, canSeeDetail: true, canEdit: true, canManage: false, canExport: false };
  }
  // agent: own rows only; detail until the admin-set cutoff for this month.
  const { agentVisibleUntilMs } = await getPeriodSetting(session.companyId, month);
  const pastCutoff = agentVisibleUntilMs !== null && Date.now() > agentVisibleUntilMs;
  return { viewAll: false, canSeeDetail: !pastCutoff, canEdit: !pastCutoff, canManage: false, canExport: false };
}
