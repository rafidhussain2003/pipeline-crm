import { NextRequest, NextResponse } from "next/server";
import { requireFinance, requireFinanceCapability, financeErrorResponse } from "@/lib/finance/guard";
import { getRevenueForInvoice, clientAddressLines, attachInvoiceToRevenue } from "@/lib/finance";
import { renderInvoicePdf } from "@/lib/finance/invoice-pdf";
import { isUuid } from "@/lib/url";

// Downloadable TAX INVOICE (export under LUT) for a revenue entry that was
// posted against a client. Entries recorded without a client have no invoice.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = await getRevenueForInvoice(auth.session.companyId, id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { doc, client, settings } = data;
  if (!doc.invoiceNumber || !client) {
    return NextResponse.json({ error: "This entry was recorded without a client, so it has no invoice. Use Receipt instead." }, { status: 400 });
  }
  if (!settings?.invoiceLegalName || !settings.invoiceAddress) {
    return NextResponse.json({ error: "Set your company's invoice details (legal name, address, GSTIN, signatory) in Finance → Settings first." }, { status: 400 });
  }

  const pdf = await renderInvoicePdf({
    voided: doc.status === "voided",
    seller: {
      legalName: settings.invoiceLegalName,
      addressLines: settings.invoiceAddress.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      gstin: settings.invoiceGstin || null,
    },
    invoiceNumber: doc.invoiceNumber,
    invoiceDate: doc.invoiceDate || doc.entryDate,
    servicePeriod: doc.servicePeriod || "",
    billTo: { name: client.name, addressLines: clientAddressLines(client), country: client.country, gstin: client.gstin },
    serviceDescription: doc.serviceDescription || `${client.serviceDescription} for ${doc.servicePeriod || ""}`.trim(),
    invoiceCurrency: doc.invoiceCurrency || client.invoiceCurrency,
    invoiceAmount: doc.invoiceAmount || doc.amount,
    baseCurrency: settings.defaultCurrency,
    baseAmount: doc.amount,
    lutNote: settings.invoiceLutNote || null,
    paymentReceivedDate: doc.entryDate,
    signatory: { name: settings.invoiceSignatoryName || "", title: settings.invoiceSignatoryTitle || "" },
  });

  const fileName = `${doc.invoiceNumber.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

// Attach / correct the client + invoice details on an existing entry. The
// posted journal is untouched; an invoice number is allocated the first time.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinanceCapability("record_income");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const revenue = await attachInvoiceToRevenue(auth.session.companyId, auth.session.userId, id, {
      clientId: String(body?.clientId ?? ""),
      invoiceNumber: typeof body?.invoiceNumber === "string" ? body.invoiceNumber : null,
      invoiceDate: typeof body?.invoiceDate === "string" ? body.invoiceDate : null,
      servicePeriod: String(body?.servicePeriod ?? ""),
      serviceDescription: typeof body?.serviceDescription === "string" ? body.serviceDescription : null,
      invoiceCurrency: typeof body?.invoiceCurrency === "string" ? body.invoiceCurrency : null,
      invoiceAmount: body?.invoiceAmount === undefined || body?.invoiceAmount === null || body?.invoiceAmount === "" ? null : Number(body.invoiceAmount),
    });
    return NextResponse.json({ revenue });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
