import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { commercialSales, sales } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSales, resolveSalesScope, currentSaleMonth } from "@/lib/sales/access";
import { isSaleStatus } from "@/lib/sales/types";
import { linkOrphanCommercialRows } from "@/lib/sales/commercial-link";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/url";

// Admin-only guard shared by both methods (canManage = admin).
async function requireCommercialAdmin() {
  const auth = await requireSales();
  if (!auth.ok) return auth;
  const scope = await resolveSalesScope(auth.session, currentSaleMonth());
  if (!scope.canManage) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Only an admin can manage Commercial Sales." }, { status: 403 }),
    };
  }
  return auth;
}

// Edit a commercial row. Add ons / Funds Status are editable on every row.
// Customer/date/product/status are editable here ONLY for STANDALONE rows
// (they're this row's own data); on a LINKED row those live on the sale — the
// page edits them through the main-ledger PATCH, which this sheet reflects.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCommercialAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [row] = await db
    .select({ id: commercialSales.id, saleId: commercialSales.saleId })
    .from(commercialSales)
    .where(and(eq(commercialSales.id, id), eq(commercialSales.companyId, session.companyId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {};
  if ("addOns" in body) set.addOns = body.addOns === null ? null : String(body.addOns).slice(0, 160);
  if ("fundsStatus" in body) set.fundsStatus = body.fundsStatus === null ? null : String(body.fundsStatus).slice(0, 60);
  if (!row.saleId) {
    // Standalone row — its own data columns.
    if ("customerName" in body) set.customerName = body.customerName === null ? null : String(body.customerName).slice(0, 200);
    if ("orderDate" in body) set.orderDate = body.orderDate === null ? null : String(body.orderDate).slice(0, 120);
    if ("product" in body) set.product = body.product === null ? null : String(body.product).slice(0, 160);
    if ("activationStatus" in body) {
      if (!isSaleStatus(body.activationStatus)) return NextResponse.json({ error: "Invalid activation status." }, { status: 400 });
      set.activationStatus = body.activationStatus;
    }
  }
  if (Object.keys(set).length === 0) return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
  set.updatedAt = new Date();

  const [updated] = await db
    .update(commercialSales)
    .set(set)
    .where(and(eq(commercialSales.id, id), eq(commercialSales.companyId, session.companyId)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A standalone row whose customer/product was just typed may now match a
  // live sale on the main ledger — link it right away so it starts following
  // that sale's status (instead of staying a disconnected copy).
  if (!row.saleId && ("customerName" in set || "product" in set)) {
    await linkOrphanCommercialRows(session.companyId);
  }

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "commercial_sale.updated",
    entityType: "commercial_sale",
    entityId: id,
    after: set,
  });
  return NextResponse.json({ row: updated });
}

// Remove a row from the sheet. A LINKED row unmarks the sale on the main
// ledger (the sale itself is untouched) and drops the link; a STANDALONE row
// is simply deleted — it never existed anywhere else.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCommercialAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [link] = await db
    .select({ id: commercialSales.id, saleId: commercialSales.saleId })
    .from(commercialSales)
    .where(and(eq(commercialSales.id, id), eq(commercialSales.companyId, session.companyId)))
    .limit(1);
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (link.saleId) {
    await db
      .update(sales)
      .set({ isCommercial: false, updatedAt: new Date() })
      .where(and(eq(sales.id, link.saleId), eq(sales.companyId, session.companyId)));
  }
  await db.delete(commercialSales).where(eq(commercialSales.id, link.id));

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: link.saleId ? "sale.unmarked_commercial" : "commercial_sale.deleted",
    entityType: link.saleId ? "sale" : "commercial_sale",
    entityId: link.saleId ?? link.id,
  });
  return NextResponse.json({ ok: true });
}
