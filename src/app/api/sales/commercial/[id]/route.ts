import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { commercialSales } from "@/db/schema";
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

// Edit a commercial row. Every field is editable here on every row. The sheet
// PULLS customer/date/product/status from the main ledger (one-way), but an
// admin edit here wins: it is recorded as an admin override and the pull skips
// that field from then on. Nothing the admin changes here is ever written to
// the main ledger (agents can see that sheet).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCommercialAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [row] = await db
    .select({ id: commercialSales.id, saleId: commercialSales.saleId, adminOverrides: commercialSales.adminOverrides })
    .from(commercialSales)
    .where(and(eq(commercialSales.id, id), eq(commercialSales.companyId, session.companyId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {};
  if ("addOns" in body) set.addOns = body.addOns === null ? null : String(body.addOns).slice(0, 160);
  if ("fundsStatus" in body) set.fundsStatus = body.fundsStatus === null ? null : String(body.fundsStatus).slice(0, 60);
  // Pulled fields — editable here on every row (caught or standalone).
  if ("customerName" in body) set.customerName = body.customerName === null ? null : String(body.customerName).slice(0, 200);
  if ("orderDate" in body) set.orderDate = body.orderDate === null ? null : String(body.orderDate).slice(0, 120);
  if ("product" in body) set.product = body.product === null ? null : String(body.product).slice(0, 160);
  if ("activationStatus" in body) {
    if (!isSaleStatus(body.activationStatus)) return NextResponse.json({ error: "Invalid activation status." }, { status: 400 });
    set.activationStatus = body.activationStatus;
  }
  if (Object.keys(set).length === 0) return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
  // The admin edited a field that the one-way pull from the main ledger would
  // otherwise refresh → record it as an admin override so the pull leaves it
  // alone from now on. (Add ons / Funds Status are never pulled, so they
  // don't need recording.) One-way: nothing here is written to the main ledger.
  const PULLED = ["customerName", "orderDate", "product", "activationStatus"] as const;
  const touched = PULLED.filter((k) => k in set);
  if (touched.length > 0) {
    const prev = Array.isArray(row.adminOverrides) ? row.adminOverrides : [];
    set.adminOverrides = Array.from(new Set([...prev, ...touched]));
  }
  set.updatedAt = new Date();

  const [updated] = await db
    .update(commercialSales)
    .set(set)
    .where(and(eq(commercialSales.id, id), eq(commercialSales.companyId, session.companyId)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A standalone row whose customer/product was just typed may now match a
  // live sale on the main ledger — attach it (sale_id) so it isn't a
  // disconnected duplicate. Attaching never changes this row's data/status.
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

// Remove a row from the Commercial sheet. This sheet is independent: Remove
// deletes the commercial row ONLY — the main Sales Ledger (and the sale's own
// "Commercial" flag there) is not touched. The row is gone from this sheet;
// re-marking the sale on the main ledger would catch it again as a fresh copy.
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

  await db.delete(commercialSales).where(eq(commercialSales.id, link.id));

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "commercial_sale.deleted",
    entityType: "commercial_sale",
    entityId: link.id,
    metadata: link.saleId ? { saleId: link.saleId } : undefined,
  });
  return NextResponse.json({ ok: true });
}
