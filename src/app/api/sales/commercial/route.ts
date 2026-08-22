import { NextResponse } from "next/server";
import { db } from "@/db";
import { commercialSales } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireSales, resolveSalesScope, currentSaleMonth } from "@/lib/sales/access";
import { linkOrphanCommercialRows, pullCommercialFromLedger } from "@/lib/sales/commercial-link";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Commercial Sales — the ADMIN-ONLY sheet, ONE-WAY from the main ledger.
// A sale marked "Commercial" is caught here, and its customer / date /
// product / ACTIVATION STATUS keep being PULLED from the main ledger on every
// load — so an agent's status update reaches this sheet. Nothing ever flows
// back: edits the admin makes here (status, add-ons, funds, anything) stay
// here, never touch the main ledger (agents can see that), and are never
// overwritten by the pull (adminOverrides). Trash/purge/unmark on the main
// ledger never removes a row here — only Remove on this sheet does.
// Ordered oldest first (append-at-bottom, like the main sheet).
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

  // Self-heal: attach any unlinked commercial row to its matching live sale
  // (a no-op once every row is linked), then PULL the latest data/status from
  // the main ledger into every linked row — one-way, main → here — skipping
  // any field the admin has edited on this sheet (adminOverrides). Nothing
  // flows back to the main ledger.
  await linkOrphanCommercialRows(session.companyId);
  await pullCommercialFromLedger(session.companyId);

  const rows = await db
    .select({
      id: commercialSales.id,
      saleId: commercialSales.saleId,
      customerName: commercialSales.customerName,
      orderDate: commercialSales.orderDate,
      product: commercialSales.product,
      accountNumber: commercialSales.accountNumber,
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
