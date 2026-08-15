import { NextResponse } from "next/server";
import { db } from "@/db";
import { commercialSales } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireSales, resolveSalesScope, currentSaleMonth } from "@/lib/sales/access";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Commercial Sales — the ADMIN-ONLY, INDEPENDENT sheet. Every row owns its
// data (customer/date/product/status): caught rows carry a snapshot that the
// main ledger's write-through keeps current while the sale exists; standalone
// rows are the admin's own entries. Nothing on the main ledger — trash,
// purge, anything — ever removes a row here; only an explicit Remove on this
// sheet does. Ordered oldest first (append-at-bottom, like the main sheet).
async function requireCommercialAdmin() {
  const auth = await requireSales();
  if (!auth.ok) return auth;
  const scope = await resolveSalesScope(auth.session, currentSaleMonth());
  if (!scope.canManage) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Only an admin can view Commercial Sales." }, { status: 403 }),
    };
  }
  return auth;
}

export async function GET() {
  const auth = await requireCommercialAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rows = await db
    .select({
      id: commercialSales.id,
      saleId: commercialSales.saleId,
      customerName: commercialSales.customerName,
      orderDate: commercialSales.orderDate,
      product: commercialSales.product,
      activationStatus: commercialSales.activationStatus,
      addOns: commercialSales.addOns,
      fundsStatus: commercialSales.fundsStatus,
    })
    .from(commercialSales)
    .where(eq(commercialSales.companyId, session.companyId))
    .orderBy(asc(commercialSales.createdAt), asc(commercialSales.id));

  return NextResponse.json({ rows, total: rows.length });
}

// Admin adds a sale directly ON this sheet: a STANDALONE row. It exists only
// here — the main Sales Ledger never sees it (no sales row, no month totals,
// no export impact). Created blank; the admin fills the cells inline.
export async function POST() {
  const auth = await requireCommercialAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const [row] = await db
    .insert(commercialSales)
    .values({ companyId: session.companyId, saleId: null })
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "commercial_sale.created",
    entityType: "commercial_sale",
    entityId: row.id,
  });

  return NextResponse.json({ row }, { status: 201 });
}
