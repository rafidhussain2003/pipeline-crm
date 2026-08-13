import { NextResponse } from "next/server";
import { db } from "@/db";
import { commercialSales, sales } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireSales, resolveSalesScope, currentSaleMonth } from "@/lib/sales/access";

// Commercial Sales — the ADMIN-ONLY sheet of sales caught by the "Commercial"
// mark on the main ledger. Each row is a link to the live sale, so customer /
// order date / product / status are always the ledger's current values (never
// a stale copy); addOns / fundsStatus are the sheet's own admin columns.
// Ordered oldest-caught first (append-at-bottom, like the main sheet).
export async function GET() {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  // canManage is admin-only — managers and agents get the same 403, so the
  // sheet does not exist for them (the spec: visible to admin ONLY).
  const scope = await resolveSalesScope(session, currentSaleMonth());
  if (!scope.canManage) {
    return NextResponse.json({ error: "Only an admin can view Commercial Sales." }, { status: 403 });
  }

  const rows = await db
    .select({
      id: commercialSales.id,
      saleId: commercialSales.saleId,
      addOns: commercialSales.addOns,
      fundsStatus: commercialSales.fundsStatus,
      // Live sale data (the caught sale's current state on the main ledger).
      orderDate: sales.orderDate,
      customerName: sales.customerName,
      product: sales.product,
      activationStatus: sales.activationStatus,
      saleMonth: sales.saleMonth,
    })
    .from(commercialSales)
    .innerJoin(sales, eq(sales.id, commercialSales.saleId))
    // A soft-deleted sale disappears from this sheet too (and reappears on
    // restore — the link row is kept).
    .where(and(eq(commercialSales.companyId, session.companyId), isNull(sales.deletedAt)))
    .orderBy(asc(commercialSales.createdAt), asc(commercialSales.id));

  return NextResponse.json({ rows, total: rows.length });
}
