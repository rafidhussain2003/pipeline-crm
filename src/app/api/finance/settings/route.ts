import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { ensureFinanceSetup, FinanceError } from "@/lib/finance";
import { db } from "@/db";
import { financeSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  await ensureFinanceSetup(auth.session.companyId);
  const [settings] = await db.select().from(financeSettings).where(eq(financeSettings.companyId, auth.session.companyId)).limit(1);
  return NextResponse.json({ settings });
}

// Partial update: only the keys present in the body change. `defaultCurrency`
// (display currency) and the invoice profile (seller block, LUT note,
// signatory, numbering) all live here.
export async function PATCH(req: NextRequest) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const set: Record<string, unknown> = {};
    const str = (k: string, max: number) => {
      if (!(k in body)) return;
      const v = body[k];
      set[k] = typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
    };
    if ("defaultCurrency" in body) {
      const currency = typeof body.defaultCurrency === "string" ? body.defaultCurrency.trim().toUpperCase() : "";
      if (!/^[A-Z]{3}$/.test(currency)) throw new FinanceError("Currency must be a 3-letter code (e.g. USD)");
      set.defaultCurrency = currency;
    }
    str("invoiceLegalName", 200);
    str("invoiceAddress", 2000);
    str("invoiceGstin", 32);
    str("invoiceLutNote", 2000);
    str("invoiceSignatoryName", 120);
    str("invoiceSignatoryTitle", 120);
    if ("invoiceNumberPrefix" in body) {
      const prefix = typeof body.invoiceNumberPrefix === "string" ? body.invoiceNumberPrefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") : "";
      set.invoiceNumberPrefix = prefix || "INV";
    }
    if ("nextInvoiceNumber" in body) {
      const n = Number(body.nextInvoiceNumber);
      if (!Number.isInteger(n) || n < 1 || n > 999999) throw new FinanceError("Next invoice number must be a whole number of 1 or more");
      set.nextInvoiceNumber = n;
      // The counter belongs to a financial year; an explicit FY pins it there
      // (e.g. "2026-27"), otherwise it applies to the FY of the next invoice.
      if ("invoiceNumberFy" in body) {
        const fy = typeof body.invoiceNumberFy === "string" ? body.invoiceNumberFy.trim() : "";
        if (fy && !/^\d{4}-\d{2}$/.test(fy)) throw new FinanceError("Financial year must look like 2026-27");
        set.invoiceNumberFy = fy || null;
      }
    }
    if (typeof set.invoiceGstin === "string") set.invoiceGstin = (set.invoiceGstin as string).toUpperCase();
    if (Object.keys(set).length === 0) throw new FinanceError("Nothing to update");
    const [settings] = await db
      .update(financeSettings)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(financeSettings.companyId, auth.session.companyId))
      .returning();
    await recordAudit({ companyId: auth.session.companyId, userId: auth.session.userId, action: "finance.settings_updated", entityType: "finance_settings", entityId: auth.session.companyId, after: set });
    return NextResponse.json({ settings });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
