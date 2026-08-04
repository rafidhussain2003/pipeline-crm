import { NextResponse } from "next/server";
import { db } from "@/db";
import { sales } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireSales, resolveSalesScope, currentSaleMonth } from "@/lib/sales/access";

// The month switcher's list: every month that has sales for this caller (an
// agent sees only months containing THEIR sales), newest first, with the
// current month always present so a new sale can be recorded.
export async function GET() {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const scope = await resolveSalesScope(session, currentSaleMonth());

  const rows = await db
    .selectDistinct({ month: sales.saleMonth })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, session.companyId),
        isNull(sales.deletedAt),
        ...(scope.viewAll ? [] : [eq(sales.agentId, session.userId)])
      )
    )
    .orderBy(desc(sales.saleMonth));

  const months = new Set(rows.map((r) => r.month));
  months.add(currentSaleMonth());
  return NextResponse.json({ months: [...months].sort().reverse() });
}
