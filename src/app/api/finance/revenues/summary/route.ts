import { NextResponse } from "next/server";
import { requireFinance } from "@/lib/finance/guard";
import { revenueMonthlySummary } from "@/lib/finance";

// Per-month revenue totals + breakdown by income account, computed server-side
// over every posted entry (voided excluded). Newest month first.
export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ months: await revenueMonthlySummary(auth.session.companyId) });
}
