import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { commercialSales, sales } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSales, resolveSalesScope, currentSaleMonth } from "@/lib/sales/access";
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

// Edit the sheet's own admin columns (Add ons / Funds Status). The live sale
// fields (customer, date, product, status) are edited on the main ledger —
// the admin can change anything there and this sheet reflects it.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCommercialAdmin();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {};
  if ("addOns" in body) set.addOns = body.addOns === null ? null : String(body.addOns).slice(0, 160);
  if ("fundsStatus" in body) set.fundsStatus = body.fundsStatus === null ? null : String(body.fundsStatus).slice(0, 60);
  if (Object.keys(set).length === 0) return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
  set.updatedAt = new Date();

  const [updated] = await db
    .update(commercialSales)
    .set(set)
    .where(and(eq(commercialSales.id, id), eq(commercialSales.companyId, session.companyId)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "commercial_sale.updated",
    entityType: "commercial_sale",
    entityId: id,
    after: { addOns: updated.addOns, fundsStatus: updated.fundsStatus },
  });
  return NextResponse.json({ row: updated });
}

// Remove from the Commercial Sales sheet: unmarks the sale on the main ledger
// (isCommercial → false) and deletes the link row. The sale itself is
// untouched — it stays on the main ledger exactly as it was.
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

  await db
    .update(sales)
    .set({ isCommercial: false, updatedAt: new Date() })
    .where(and(eq(sales.id, link.saleId), eq(sales.companyId, session.companyId)));
  await db.delete(commercialSales).where(eq(commercialSales.id, link.id));

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "sale.unmarked_commercial",
    entityType: "sale",
    entityId: link.saleId,
  });
  return NextResponse.json({ ok: true });
}
