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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

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

// ── One-way PULL: main ledger → Commercial sheet ───────────────────────────
// Refresh every LINKED commercial row from its live main-ledger sale —
// customer / order date / product / account number from the sale. STATUS is
// special: it mirrors the sale until the admin sets it here, after which the
// Commercial sheet owns it and writes ONLY the status back to the sale (see
// the per-row logic below). No other field ever flows back to the main ledger.
//
// The admin's own edits on the Commercial sheet win: any field listed in the
// row's adminOverrides is skipped, so the pull never overwrites what the admin
// set here — while every field they haven't touched keeps following the sale.
// Called on every Commercial Sales page load; one read of the linked sales +
// only the rows whose values actually differ are written.
export async function pullCommercialFromLedger(companyId: string): Promise<number> {
  const rows = await db
    .select({
      id: commercialSales.id,
      saleId: commercialSales.saleId,
      customerName: commercialSales.customerName,
      orderDate: commercialSales.orderDate,
      product: commercialSales.product,
      accountNumber: commercialSales.accountNumber,
      activationStatus: commercialSales.activationStatus,
      adminOverrides: commercialSales.adminOverrides,
    })
    .from(commercialSales)
    .where(and(eq(commercialSales.companyId, companyId), sql`${commercialSales.saleId} is not null`));
  if (rows.length === 0) return 0;

  const saleIds = rows.map((r) => r.saleId as string);
  const live = await db
    .select({
      id: sales.id,
      customerName: sales.customerName,
      orderDate: sales.orderDate,
      product: sales.product,
      accountNumber: sales.accountNumber,
      activationStatus: sales.activationStatus,
    })
    .from(sales)
    .where(and(eq(sales.companyId, companyId), inArray(sales.id, saleIds), isNull(sales.deletedAt)));
  const liveById = new Map(live.map((s) => [s.id, s]));

  let pulled = 0;
  for (const r of rows) {
    const s = liveById.get(r.saleId as string);
    if (!s) continue; // sale trashed/purged → the row keeps its last-known data
    const overrides = new Set(Array.isArray(r.adminOverrides) ? r.adminOverrides : []);
    const set: Record<string, unknown> = {};
    if (!overrides.has("customerName") && (s.customerName ?? null) !== (r.customerName ?? null)) set.customerName = s.customerName;
    if (!overrides.has("orderDate") && (s.orderDate ?? null) !== (r.orderDate ?? null)) set.orderDate = s.orderDate;
    if (!overrides.has("product") && (s.product ?? null) !== (r.product ?? null)) set.product = s.product;
    if (!overrides.has("accountNumber") && (s.accountNumber ?? null) !== (r.accountNumber ?? null)) set.accountNumber = s.accountNumber;
    // STATUS is the one field that flows BOTH ways, decided by who owns it:
    //  • Until the admin sets the status on the Commercial sheet, the row just
    //    MIRRORS the sale (pull main → commercial) — so it always shows the
    //    agent's current status and an agent edit is never reverted.
    //  • Once the admin HAS set it here (adminOverrides has "activationStatus"),
    //    the Commercial sheet OWNS the status and writes it BACK to the sale on
    //    the main ledger — status ONLY, nothing else.
    if (!overrides.has("activationStatus")) {
      if (s.activationStatus !== r.activationStatus) set.activationStatus = s.activationStatus; // pull → commercial
    }
    if (Object.keys(set).length > 0) {
      set.updatedAt = new Date();
      await db.update(commercialSales).set(set).where(eq(commercialSales.id, r.id));
      pulled++;
    }
    if (overrides.has("activationStatus") && s.activationStatus !== r.activationStatus) {
      await db
        .update(sales)
        .set({ activationStatus: r.activationStatus, updatedAt: new Date() })
        .where(and(eq(sales.id, s.id), eq(sales.companyId, companyId))); // push commercial → main (status only)
      pulled++;
    }
  }
  return pulled;
}
