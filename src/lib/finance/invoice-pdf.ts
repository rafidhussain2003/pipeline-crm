// Export TAX INVOICE (GST, supply under LUT without payment of IGST) — one A4
// page rendered server-side with pdf-lib. The layout mirrors the company's
// manually-made invoice exactly, block for block:
//
//   TAX INVOICE
//   ┌ seller name / address / GSTIN ──┬ Invoice No. / Date / Service Period ┐
//   ┌ Bill To: client name / address / Country ───────────────────────────┐
//   ┌ Description of Services ───────────────────────────────┬ Amount ─────┐
//   │ <service description>                                  │ USD 104.00  │
//   │ Total Invoice Value                                    │ USD 104.00  │
//   ┌ GST / IGST ───────────────────────────────────────────┬ 0.00 ───────┐
//   │ Total Payable                                          │ USD 104.00  │
//   │ INR equivalent received                                │ INR 9,440.00│
//   Supply meant for export under LUT … / LUT note / Payment received
//   For <seller>  …  Authorized Signatory / name / title
//
// Amounts print with currency CODES ("USD 104.00", "INR 9,440.00"): the
// base-14 Helvetica font has no ₹ glyph, and a missing-glyph box on a tax
// document is worse than a code.
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";

export interface InvoicePdfInput {
  voided: boolean;
  seller: { legalName: string; addressLines: string[]; gstin: string | null };
  invoiceNumber: string;
  invoiceDate: string; // ISO
  servicePeriod: string;
  billTo: { name: string; addressLines: string[]; country: string; gstin?: string | null };
  serviceDescription: string;
  invoiceCurrency: string;
  invoiceAmount: string; // "104.00"
  baseCurrency: string;
  baseAmount: string; // "9440.00"
  lutNote: string | null;
  paymentReceivedDate: string; // ISO
  signatory: { name: string; title: string };
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.1);
const BORDER = rgb(0.25, 0.25, 0.25);
const TABLE_BORDER = rgb(0.72, 0.72, 0.72);
const HEAD_BG = rgb(0.95, 0.95, 0.95);
const PAD = 10;
const LINE = 13.5;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// WinAnsi (what Helvetica uses) covers Latin-1 plus common typographic marks;
// anything else becomes "?" rather than failing the whole download.
function safe(s: string): string {
  return s.replace(/[–—‘’“”… ]/g, (c) => c).replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”…]/g, "?");
}

export function fmtInvoiceDate(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function fmtAmount(code: string, value: string | number): string {
  const n = Number(value) || 0;
  return `${code} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrap(font: PDFFont, size: number, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const probe = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(probe, size) <= maxW || !line) line = probe;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.invoiceNumber} — Tax Invoice`);
  pdf.setAuthor(input.seller.legalName);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const text = (x: number, y: number, s: string, size: number, font: PDFFont = regular) => {
    page.drawText(safe(s), { x, y, size, font, color: INK });
  };
  const textRight = (rightX: number, y: number, s: string, size: number, font: PDFFont = regular) => {
    const w = font.widthOfTextAtSize(safe(s), size);
    page.drawText(safe(s), { x: rightX - w, y, size, font, color: INK });
  };
  const box = (x: number, y: number, w: number, h: number, color = BORDER, width = 0.9) => {
    page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: width });
  };
  const vline = (x: number, y1: number, y2: number, color = BORDER, width = 0.9) => {
    page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, color, thickness: width });
  };

  let y = PAGE_H - 52;

  // ── Title ──────────────────────────────────────────────────────────────
  const title = "TAX INVOICE";
  textRight(PAGE_W / 2 + bold.widthOfTextAtSize(title, 20) / 2, y, title, 20, bold);
  if (input.voided) {
    const stamp = "VOIDED";
    page.drawText(stamp, { x: PAGE_W / 2 - bold.widthOfTextAtSize(stamp, 11) / 2, y: y - 16, size: 11, font: bold, color: rgb(0.8, 0.1, 0.1) });
  }
  y -= 36;

  // ── Seller + invoice meta box ──────────────────────────────────────────
  const leftW = CONTENT_W * 0.615;
  const sellerLines = [
    { s: input.seller.legalName, f: bold },
    ...input.seller.addressLines.flatMap((l) => wrap(regular, 10, l, leftW - PAD * 2).map((s) => ({ s, f: regular }))),
    ...(input.seller.gstin ? [{ s: `GSTIN: ${input.seller.gstin}`, f: regular }] : []),
  ];
  const meta: { label: string; value: string }[] = [
    { label: "Invoice No.:", value: input.invoiceNumber },
    { label: "Invoice Date:", value: fmtInvoiceDate(input.invoiceDate) },
    { label: "Service Period:", value: input.servicePeriod },
  ];
  const boxAH = Math.max(sellerLines.length, meta.length) * LINE + PAD * 2 - 2;
  box(MARGIN, y - boxAH, CONTENT_W, boxAH);
  vline(MARGIN + leftW, y - boxAH, y);
  let ly = y - PAD - 9;
  for (const l of sellerLines) { text(MARGIN + PAD, ly, l.s, 10, l.f); ly -= LINE; }
  let ry = y - PAD - 9;
  for (const m of meta) {
    const vw = regular.widthOfTextAtSize(safe(m.value), 10);
    const lw = bold.widthOfTextAtSize(m.label, 10);
    const right = MARGIN + CONTENT_W - PAD;
    text(right - vw, ry, m.value, 10, regular);
    text(right - vw - 4 - lw, ry, m.label, 10, bold);
    ry -= LINE;
  }
  y -= boxAH + 12;

  // ── Bill To box ────────────────────────────────────────────────────────
  const billLines = [
    { s: "Bill To", f: bold },
    { s: input.billTo.name, f: regular },
    ...input.billTo.addressLines.flatMap((l) => wrap(regular, 10, l, CONTENT_W - PAD * 2).map((s) => ({ s, f: regular }))),
    { s: `Country: ${input.billTo.country}`, f: regular },
    ...(input.billTo.gstin ? [{ s: `GSTIN: ${input.billTo.gstin}`, f: regular }] : []),
  ];
  const boxBH = billLines.length * LINE + PAD * 2 - 2;
  box(MARGIN, y - boxBH, CONTENT_W, boxBH);
  ly = y - PAD - 9;
  for (const l of billLines) { text(MARGIN + PAD, ly, l.s, 10, l.f); ly -= LINE; }
  y -= boxBH + 16;

  // ── Services table ─────────────────────────────────────────────────────
  const amountColW = 150;
  const descColW = CONTENT_W - amountColW;
  const ROW_H = 32;
  const row = (top: number, left: string, right: string, opts: { bold?: boolean; head?: boolean } = {}) => {
    if (opts.head) page.drawRectangle({ x: MARGIN, y: top - ROW_H, width: CONTENT_W, height: ROW_H, color: HEAD_BG });
    box(MARGIN, top - ROW_H, CONTENT_W, ROW_H, TABLE_BORDER, 0.8);
    vline(MARGIN + descColW, top - ROW_H, top, TABLE_BORDER, 0.8);
    const f = opts.bold || opts.head ? bold : regular;
    text(MARGIN + PAD, top - ROW_H / 2 - 3.5, left, 10, f);
    textRight(MARGIN + CONTENT_W - PAD, top - ROW_H / 2 - 3.5, right, 10, f);
  };
  const invoiceAmt = fmtAmount(input.invoiceCurrency, input.invoiceAmount);
  row(y, "Description of Services", "Amount", { head: true }); y -= ROW_H;
  row(y, input.serviceDescription, invoiceAmt); y -= ROW_H;
  row(y, "Total Invoice Value", invoiceAmt, { bold: true }); y -= ROW_H;
  y -= 12;

  // ── Tax + payable box ──────────────────────────────────────────────────
  row(y, "GST / IGST", "0.00", { bold: true }); y -= ROW_H;
  row(y, "Total Payable", invoiceAmt, { bold: true }); y -= ROW_H;
  if (input.baseCurrency !== input.invoiceCurrency) {
    row(y, `${input.baseCurrency} equivalent received`, fmtAmount(input.baseCurrency, input.baseAmount), { bold: true }); y -= ROW_H;
  }
  y -= 22;

  // ── LUT declaration ────────────────────────────────────────────────────
  text(MARGIN, y, "Supply meant for export under Letter of Undertaking (LUT) without payment of IGST.", 10.5, bold);
  y -= 18;
  if (input.lutNote) {
    for (const l of wrap(regular, 8.5, input.lutNote, CONTENT_W)) { text(MARGIN, y, l, 8.5); y -= 11.5; }
  }
  y -= 18;

  // ── Payment received ───────────────────────────────────────────────────
  const prLabel = "Payment received:";
  text(MARGIN, y, prLabel, 10.5, bold);
  text(MARGIN + bold.widthOfTextAtSize(prLabel, 10.5) + 5, y, fmtInvoiceDate(input.paymentReceivedDate), 10.5);
  y -= 46;

  // ── Signature block ────────────────────────────────────────────────────
  const right = MARGIN + CONTENT_W;
  textRight(right, y, `For ${input.seller.legalName}`, 9.5);
  y -= 50;
  textRight(right, y, "Authorized Signatory", 9.5, bold);
  y -= 14;
  if (input.signatory.name) { textRight(right, y, input.signatory.name, 9.5); y -= 14; }
  if (input.signatory.title) { textRight(right, y, input.signatory.title, 9.5); }

  return pdf.save();
}

