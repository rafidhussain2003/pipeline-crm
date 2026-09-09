import { NextResponse } from "next/server";
import { requireFinance } from "@/lib/finance/guard";
import { expenseMonthlySummary } from "@/lib/finance";

// Per-month expense totals classified by category, payment method and document
// type, computed server-side over every posted entry (voided excluded).
export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ months: await expenseMonthlySummary(auth.session.companyId) });
}
