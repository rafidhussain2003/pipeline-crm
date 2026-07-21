// Enterprise Finance Workspace — dependency-free PDF receipts.
//
// A receipt is one A4 page of text. Rather than adding a PDF library to a
// live app for that, this builds the document by hand: a fixed five-object
// PDF (catalog → pages → page → Helvetica fonts → content stream) with a
// byte-accurate xref table. Text is sanitized to ASCII (amounts render as
// "USD 1,234.00" — currency CODES, deliberately, because base-14 Helvetica
// has no glyphs for ₹/€/₨ and a wrong symbol on a financial document is
// worse than a code). Deterministic output, no I/O, trivially testable.

type ReceiptRow = { label: string; value: string };

export interface ReceiptInput {
  companyName: string;
  title: string; // "Payment Receipt" | "Income Receipt"
  docLabel: string; // "Expense #12"
  rows: ReceiptRow[];
  amountLabel: string;
  amount: string; // pre-formatted, e.g. "USD 1,234.00"
  footer?: string;
}

// Keep byte length == string length (latin1) and escape PDF string syntax.
function pdfText(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function buildReceiptPdf(input: ReceiptInput): Uint8Array {
  const lines: string[] = [];
  const text = (x: number, y: number, size: number, font: "F1" | "F2", s: string) => {
    lines.push(`BT /${font} ${size} Tf ${x} ${y} Td (${pdfText(s)}) Tj ET`);
  };
  const rule = (y: number) => {
    lines.push(`0.85 0.87 0.9 RG 0.75 w 50 ${y} m 545 ${y} l S`);
  };

  let y = 790;
  text(50, y, 20, "F2", input.companyName);
  y -= 26;
  text(50, y, 12, "F1", input.title);
  y -= 8;
  rule(y);
  y -= 24;
  text(50, y, 11, "F2", input.docLabel);
  y -= 22;
  for (const row of input.rows) {
    text(50, y, 10, "F1", row.label);
    text(200, y, 10, "F2", row.value);
    y -= 18;
  }
  y -= 10;
  rule(y);
  y -= 28;
  text(50, y, 12, "F1", input.amountLabel);
  text(200, y, 16, "F2", input.amount);
  y -= 36;
  text(50, y, 8, "F1", input.footer ?? `Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC — system record, no signature required.`);

  const content = lines.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
