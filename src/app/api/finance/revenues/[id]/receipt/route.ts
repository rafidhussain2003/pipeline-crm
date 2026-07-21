import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies, financeRevenues, financeSettings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireFinance } from "@/lib/finance/guard";
import { buildReceiptPdf } from "@/lib/finance/receipt-pdf";
import { isUuid } from "@/lib/url";

// Downloadable PDF receipt for a revenue document (income / other income).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [[doc], [company], [settings]] = await Promise.all([
    db.select().from(financeRevenues).where(and(eq(financeRevenues.id, id), eq(financeRevenues.companyId, auth.session.companyId))).limit(1),
    db.select({ name: companies.name }).from(companies).where(eq(companies.id, auth.session.companyId)).limit(1),
    db.select({ defaultCurrency: financeSettings.defaultCurrency }).from(financeSettings).where(eq(financeSettings.companyId, auth.session.companyId)).limit(1),
  ]);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const currency = settings?.defaultCurrency ?? "USD";
  const amount = `${currency} ${Number(doc.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const pdf = buildReceiptPdf({
    companyName: company?.name || "Company",
    title: "Income Receipt",
    docLabel: `Revenue #${doc.docNumber}${doc.status === "voided" ? " (VOIDED)" : ""}`,
    rows: [
      { label: "Date", value: doc.entryDate },
      { label: "Received from", value: doc.customerName },
      ...(doc.invoiceRef ? [{ label: "Invoice ref", value: doc.invoiceRef }] : []),
      ...(doc.notes ? [{ label: "Notes", value: doc.notes.slice(0, 90) }] : []),
    ],
    amountLabel: "Amount received",
    amount,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="revenue-${doc.docNumber}-receipt.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
