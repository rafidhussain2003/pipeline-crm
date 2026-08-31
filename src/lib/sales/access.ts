// Sales Ledger — the ONE place authorization + agent visibility is decided.
//
// Role gate (per the owner): the MASTER sheet is admin + backend_agent only.
// Agents keep posting/working THEIR OWN rows (that is how sales enter the
// ledger). Managers, finance/hr employees, lead_distributor and super_admin
// have no access and get a 403.
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
  if (r !== "admin" && r !== "backend_agent" && r !== "agent") {
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

// AUTOMATIC agent cutoff: a month's sheet stays fully visible to agents through
// the 15th of the FOLLOWING month, then flips to summary-only. e.g. the
// 2026-08 sheet shows in full until 15 Sep 2026 (end of day); from 16 Sep 2026
// agents see only the counts. Returns the cutoff instant (ms) — the first
// moment agents no longer see detail (16th, 00:00 local). This is the default;
// an admin's manual "visible to agents until" setting, when present, overrides
// it for that month (see resolveSalesScope).
export function autoAgentCutoffMs(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return Number.POSITIVE_INFINITY; // unknown month → never auto-hide (safe default)
  let year = Number(m[1]);
  let mo = Number(m[2]) + 1; // the FOLLOWING month (1-based)
  if (mo > 12) { mo = 1; year += 1; }
  // 16th, 00:00 local → agents see detail strictly before this (through the 15th).
  return new Date(year, mo - 1, 16, 0, 0, 0, 0).getTime();
}

export type SalesScope = {
  // admin + backend_agent see every agent's rows; an agent is hard-scoped to
  // their own.
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
  if (session.role === "backend_agent") {
    // Backend Agent: the sales-processing employee — sees + works EVERY sale
    // (edit statuses/details), never subject to the agent cutoff, but no
    // destructive/config powers (delete/restore/visibility/backend-team) and
    // NO export/download — both stay admin-only.
    return { viewAll: true, canSeeDetail: true, canEdit: true, canManage: false, canExport: false };
  }
  // agent: own rows only. Detail is visible until the cutoff for this month —
  // by default the 15th of the following month (automatic), unless an admin has
  // set a manual "visible to agents until" date, which overrides it. Past the
  // cutoff the API returns summary counts only (no rows, no PII).
  const { agentVisibleUntilMs } = await getPeriodSetting(session.companyId, month);
  const cutoffMs = agentVisibleUntilMs ?? autoAgentCutoffMs(month);
  const pastCutoff = Date.now() > cutoffMs;
  return { viewAll: false, canSeeDetail: !pastCutoff, canEdit: !pastCutoff, canManage: false, canExport: false };
}
