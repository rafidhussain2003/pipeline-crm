import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { planInvoiceRenumber, renumberInvoices, financialYearLabel, todayDate } from "@/lib/finance";

// Renumber a financial year's invoices in chronological order.
//   GET  ?fy=2026-27&startAt=3  → preview (old → new per entry), nothing changes
//   POST { fy, startAt }        → apply; the counter continues after the last
function parse(fy: string | null, startAt: string | number | null) {
  return { fy: fy && /^\d{4}-\d{2}$/.test(fy) ? fy : financialYearLabel(todayDate()), startAt: Math.max(1, Math.floor(Number(startAt) || 1)) };
}

export async function GET(req: NextRequest) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const { fy, startAt } = parse(p.get("fy"), p.get("startAt"));
  const plan = await planInvoiceRenumber(auth.session.companyId, fy, startAt);
  return NextResponse.json({ fy, startAt, plan });
}

export async function POST(req: NextRequest) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { fy, startAt } = parse(typeof body?.fy === "string" ? body.fy : null, body?.startAt ?? null);
  try {
    const result = await renumberInvoices(auth.session.companyId, auth.session.userId, fy, startAt);
    return NextResponse.json(result);
  } catch (err) {
    return financeErrorResponse(err);
  }
}
