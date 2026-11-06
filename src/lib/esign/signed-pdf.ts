// E-Sign — builds the SIGNED PDF: the original with every filled field burned
// in (signature/initials PNGs, dates, text, check marks) plus a "Certificate
// of Completion" page listing signers, timestamps, IPs and the event trail —
// the same shape DocuSign appends. Field positions are fractions of the page
// (x,y = top-left in a top-down coordinate system); pdf-lib's origin is
// bottom-left, hence the y flip.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { esignDocuments, esignEvents, esignFields, esignSigners } from "@/db/schema";

type Doc = typeof esignDocuments.$inferSelect;
type Signer = typeof esignSigners.$inferSelect;
type Field = typeof esignFields.$inferSelect;
type Event = typeof esignEvents.$inferSelect;

const INK = rgb(0.05, 0.05, 0.2);
const MUTED = rgb(0.4, 0.4, 0.45);

function safe(s: string): string {
  return s.replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, "...").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}
function fmt(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
}
function wrap(font: PDFFont, size: number, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\r?\n/)) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(probe, size) <= maxW || !line) line = probe;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
// Largest font size (≤ max) at which `text` fits the box.
function fitText(font: PDFFont, text: string, w: number, h: number, max = 12): number {
  let size = Math.min(max, h * 0.75);
  while (size > 4 && font.widthOfTextAtSize(text, size) > w - 4) size -= 0.5;
  return size;
}

export async function buildSignedPdf(input: { original: Buffer; doc: Doc; signers: Signer[]; fields: Field[]; events: Event[] }): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.original, { ignoreEncryption: true });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const signerById = new Map(input.signers.map((s) => [s.id, s]));
  const imageCache = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>();
  const embed = async (dataUrl: string) => {
    let img = imageCache.get(dataUrl);
    if (!img) { img = await pdf.embedPng(Buffer.from(dataUrl.split(",")[1], "base64")); imageCache.set(dataUrl, img); }
    return img;
  };

  // ── Burn the fields in ─────────────────────────────────────────────────
  for (const f of input.fields) {
    if (!f.value) continue;
    const page = pages[f.page - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const x = f.x * pw, w = f.w * pw, h = f.h * ph;
    const y = ph - (f.y + f.h) * ph; // bottom edge in PDF coordinates
    const signer = signerById.get(f.signerId);
    if (f.type === "signature" || f.type === "initials") {
      const data = f.type === "signature" ? signer?.signatureData : signer?.initialsData;
      if (!data) continue;
      const img = await embed(data);
      // Fit the image inside the box, keep its aspect ratio, align bottom-left.
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      page.drawImage(img, { x, y, width: dw, height: dh });
    } else if (f.type === "checkbox") {
      if (f.value === "true") {
        const size = Math.min(w, h);
        const s = fitText(bold, "X", size, size, size);
        page.drawText("X", { x: x + (w - bold.widthOfTextAtSize("X", s)) / 2, y: y + (h - s * 0.72) / 2, size: s, font: bold, color: INK });
      }
    } else {
      const text = safe(f.value);
      const size = fitText(regular, text, w, h);
      page.drawText(text, { x: x + 2, y: y + (h - size * 0.72) / 2, size, font: regular, color: INK });
    }
  }

  // ── Certificate of Completion ──────────────────────────────────────────
  let cert: PDFPage = pdf.addPage([595.28, 841.89]);
  const M = 48;
  let y = 841.89 - 56;
  // Continue on a fresh page when the certificate runs long (many events).
  const ensureRoom = (needed: number) => { if (y < 48 + needed) { cert = pdf.addPage([595.28, 841.89]); y = 841.89 - 56; } };
  const text = (s: string, size: number, font: PDFFont = regular, color = INK, x = M) => { cert.drawText(safe(s), { x, y, size, font, color }); };
  const line = (s: string, size = 9.5, font: PDFFont = regular, color = INK, x = M) => { ensureRoom(size + 4); text(s, size, font, color, x); y -= size + 4; };
  const para = (s: string, size = 9.5, font: PDFFont = regular, color = INK) => { for (const l of wrap(font, size, s, 595.28 - M * 2)) line(l, size, font, color); };
  const rule = () => { cert.drawLine({ start: { x: M, y: y + 4 }, end: { x: 595.28 - M, y: y + 4 }, thickness: 0.6, color: rgb(0.8, 0.8, 0.85) }); y -= 10; };

  line("Certificate of Completion", 18, bold); y -= 4;
  line(`Document: ${input.doc.title}`, 10.5, bold);
  line(`Envelope ID: ${input.doc.id}`, 9, regular, MUTED);
  line(`${input.doc.pageCount} page${input.doc.pageCount === 1 ? "" : "s"} · ${input.doc.fileName} · ${input.doc.fileSize.toLocaleString("en-US")} bytes`, 9, regular, MUTED);
  y -= 6; rule();
  line("Timeline", 12, bold);
  line(`Created: ${fmt(input.doc.createdAt)}`);
  line(`Sent: ${fmt(input.doc.sentAt)}`);
  line(`Completed: ${fmt(new Date())}`);
  line("Status: Completed", 9.5, bold);
  y -= 6; rule();
  line("Signers", 12, bold);
  for (const s of input.signers) {
    line(`${s.name}  <${s.email}>`, 10, bold);
    line(`Status: ${s.status === "signed" ? "Signed" : s.status}`, 9, regular, MUTED, M + 12);
    line(`Sent: ${fmt(s.sentAt)}   Viewed: ${fmt(s.viewedAt)}   Signed: ${fmt(s.signedAt)}`, 9, regular, MUTED, M + 12);
    line(`IP address: ${s.ipAddress || "—"}`, 9, regular, MUTED, M + 12);
    if (s.userAgent) for (const l of wrap(regular, 8, `Device: ${s.userAgent}`, 595.28 - M * 2 - 12)) line(l, 8, regular, MUTED, M + 12);
    const own = input.fields.filter((f) => f.signerId === s.id);
    line(`Fields completed: ${own.filter((f) => f.value).length} of ${own.length}`, 9, regular, MUTED, M + 12);
    if (s.signatureData) {
      try {
        const img = await embed(s.signatureData);
        const scale = Math.min(120 / img.width, 36 / img.height);
        ensureRoom(44);
        y -= 38;
        cert.drawImage(img, { x: M + 12, y, width: img.width * scale, height: img.height * scale });
        y -= 6;
      } catch { /* a broken image never blocks the certificate */ }
    }
    y -= 6;
  }
  rule();
  line("Event trail", 12, bold);
  for (const e of input.events) {
    const who = e.signerId ? signerById.get(e.signerId)?.name : "Sender";
    const detail = e.detail ? ` — ${e.detail}` : "";
    for (const l of wrap(regular, 8.5, `${fmt(e.createdAt)}  ${e.kind.toUpperCase()}  ${who ?? ""}${detail}${e.ipAddress ? `  (${e.ipAddress})` : ""}`, 595.28 - M * 2)) line(l, 8.5, regular, MUTED);
  }
  y -= 8;
  para("This document was signed electronically. Each signer accessed it through a unique, private link sent to their email address; the time, IP address and device of every action are recorded above. The signed document is the version with the fields filled in, followed by this certificate.", 8, regular, MUTED);

  pdf.setTitle(`${input.doc.title} (signed)`);
  return pdf.save();
}
