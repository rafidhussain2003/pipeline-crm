// Commercial Sales — keeping every sheet row LINKED to its main-ledger sale.
//
// A commercial row only follows the main ledger (activation status above all)
// through its sale_id link. Rows the admin added directly on the Commercial
// sheet start unlinked (sale_id null) — and rows caught before the link model
// existed may be too. This helper finds every unlinked row that clearly
// corresponds to a live main-ledger sale (same customer name + same product,
// case/space-insensitive) and links it, copying the sale's current status/
// data in. After that the normal write-through keeps it in sync forever.
//
// Deliberately conservative: it links only when the match is unambiguous
// (exactly one live sale with that name+product that is not already linked
// to another commercial row). It never merges or deletes rows — a duplicate
// the admin created stays visible for them to Remove.
import { db } from "@/db";
import { commercialSales, sales } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

export async function linkOrphanCommercialRows(companyId: string): Promise<number> {
  const orphans = await db
    .select({ id: commercialSales.id, customerName: commercialSales.customerName, product: commercialSales.product, orderDate: commercialSales.orderDate })
    .from(commercialSales)
    .where(and(eq(commercialSales.companyId, companyId), isNull(commercialSales.saleId)));
  if (orphans.length === 0) return 0;

  // Live sales already linked to some commercial row — never re-link those.
  const linkedIds = new Set(
    (
      await db
        .select({ saleId: commercialSales.saleId })
        .from(commercialSales)
        .where(and(eq(commercialSales.companyId, companyId), sql`${commercialSales.saleId} is not null`))
    ).map((r) => r.saleId as string)
  );

  const liveSales = await db
    .select({
      id: sales.id,
      customerName: sales.customerName,
      product: sales.product,
      orderDate: sales.orderDate,
    })
    .from(sales)
    .where(and(eq(sales.companyId, companyId), isNull(sales.deletedAt)));

  // Index unlinked live sales by name+product; track ambiguity.
  const byKey = new Map<string, typeof liveSales>();
  for (const s of liveSales) {
    if (linkedIds.has(s.id)) continue;
    const key = `${norm(s.customerName)}||${norm(s.product)}`;
    if (!norm(s.customerName)) continue;
    const arr = byKey.get(key) || [];
    arr.push(s);
    byKey.set(key, arr);
  }

  let linked = 0;
  for (const o of orphans) {
    if (!norm(o.customerName)) continue;
    const key = `${norm(o.customerName)}||${norm(o.product)}`;
    const candidates = byKey.get(key);
    if (!candidates || candidates.length !== 1) continue; // none or ambiguous → leave it
    const s = candidates[0];
    await db
      .update(commercialSales)
      .set({
        saleId: s.id,
        customerName: o.customerName || s.customerName,
        orderDate: o.orderDate || s.orderDate,
        product: o.product || s.product,
        updatedAt: new Date(),
      })
      .where(eq(commercialSales.id, o.id));
    // Also mark the sale commercial on the ledger so the two sheets agree.
    await db.update(sales).set({ isCommercial: true, updatedAt: new Date() }).where(eq(sales.id, s.id));
    byKey.delete(key); // consumed — a second orphan with the same key stays unlinked
    linkedIds.add(s.id);
    linked++;
  }
  return linked;
}
