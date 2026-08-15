// HR — real PDF rendering of the Offer Letter and the Employment & Data
// Protection Agreement (server-side, pdf-lib, no browser involved).
//
// A small layout engine over pdf-lib: word-wrapped paragraphs with inline
// bold, headings, tables, the highlighted zero-tolerance box, signature blocks,
// and automatic page breaks — with the company letterhead (logo, name,
// tagline, GST/phone/email) drawn at the top and the office address at the
// bottom of EVERY page. Output is a byte-exact PDF file the browser downloads
// directly (no print dialog, no browser headers/footers, no overlap).
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import { COMPANY_LETTERHEAD, type OfferLetterInput } from "./offer-letter";

// ── Page geometry (A4, points) ────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const HEADER_H = 92; // letterhead block height
const FOOTER_H = 32; // address bar height
const TOP_Y = PAGE_H - HEADER_H - 10; // first baseline area
const BOTTOM_Y = FOOTER_H + 12; // don't write below this

const INK = rgb(0.12, 0.12, 0.12);
const TAN = rgb(0.788, 0.718, 0.612); // #c9b79c
const MUTED = rgb(0.35, 0.35, 0.35);
const RULE = rgb(0.8, 0.84, 0.88);
const RED = rgb(0.86, 0.15, 0.15);
const RED_DARK = rgb(0.72, 0.11, 0.11);
const RED_BG = rgb(0.996, 0.949, 0.949);
const TABLE_HEAD_BG = rgb(0.973, 0.98, 0.988);
const FOOT_BG = rgb(0.953, 0.957, 0.965);

// Base-14 Helvetica has no glyphs for some typographic characters — map them
// to safe equivalents so nothing renders as a missing box.
function safe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x00-\xFF]/g, "?");
}

// Inline-bold markup: **bold** segments inside a paragraph.
type Run = { text: string; bold: boolean };
function parseRuns(s: string): Run[] {
  const runs: Run[] = [];
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith("**") && p.endsWith("**")) runs.push({ text: p.slice(2, -2), bold: true });
    else runs.push({ text: p, bold: false });
  }
  return runs;
}

type Word = { text: string; bold: boolean; width: number };
type Line = { words: Word[]; width: number };

class Doc {
  readonly pdf: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
  readonly boldItalic: PDFFont;
  page!: PDFPage;
  y = TOP_Y;
  private pageNo = 0;
  private readonly footerTitle: string;

  private constructor(pdf: PDFDocument, fonts: [PDFFont, PDFFont, PDFFont, PDFFont], footerTitle: string) {
    this.pdf = pdf;
    [this.regular, this.bold, this.italic, this.boldItalic] = fonts;
    this.footerTitle = footerTitle;
  }

  static async create(footerTitle: string): Promise<Doc> {
    const pdf = await PDFDocument.create();
    const fonts: [PDFFont, PDFFont, PDFFont, PDFFont] = [
      await pdf.embedFont(StandardFonts.Helvetica),
      await pdf.embedFont(StandardFonts.HelveticaBold),
      await pdf.embedFont(StandardFonts.HelveticaOblique),
      await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    ];
    const d = new Doc(pdf, fonts, footerTitle);
    d.newPage();
    return d;
  }

  // ── Pages + chrome ────────────────────────────────────────────────────
  newPage(): void {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pageNo++;
    this.drawLetterhead();
    this.drawFooter();
    this.y = TOP_Y;
  }

  private drawLogo(x: number, y: number, w: number, h: number): void {
    // The Brivent logomark, drawn as filled vector paths (same outline as the
    // on-screen SVG): a rounded "B" in dark, cut by a wide tan diagonal band
    // running lower-left → upper-right. The B is drawn in three pieces along
    // the band so the band reads as a clean cut: dark upper-left segment, tan
    // band, dark lower-right segment. Path coordinates are in a 100×130 box,
    // scaled to (w,h) and flipped to PDF's y-up axis via drawSvgPath.
    const p = this.page;
    const s = w / 100; // uniform scale (h/130 == w/100 for the intended ratio)
    // pdf-lib's drawSvgPath draws with y DOWN from (x, y) — pass the TOP-left.
    const opts = { x, y: y + h, scale: s } as const;
    // Full B outline (two lobes), used for both dark segments via clipping
    // approximation: we draw the upper-left dark part and lower-right dark
    // part as their own closed shapes, and the band as a parallelogram.
    // Upper-left dark segment of the B (above the band).
    p.drawSvgPath("M0 0 H62 A32 32 0 0 1 90 22 L0 82 Z", { ...opts, color: INK, borderWidth: 0 });
    // Lower-right dark segment of the B (below the band).
    p.drawSvgPath("M100 60 A34 34 0 0 1 68 130 H0 V118 Z", { ...opts, color: INK, borderWidth: 0 });
    // Tan diagonal band across the mark — the band itself is what separates
    // the two dark parts, exactly like the supplied logo (no inner notch).
    p.drawSvgPath("M0 82 L90 22 A32 32 0 0 1 100 60 L0 118 Z", { ...opts, color: TAN, borderWidth: 0 });
  }

  private drawLetterhead(): void {
    const C = COMPANY_LETTERHEAD;
    const p = this.page;
    const top = PAGE_H - 22;
    // logo
    this.drawLogo(MARGIN_X, top - 40, 30, 40);
    // company name
    const nameX = MARGIN_X + 40;
    p.drawText(safe(C.name), { x: nameX, y: top - 20, size: 17.5, font: this.bold, color: INK });
    // tan rule with end dots
    const ruleY = top - 27;
    p.drawLine({ start: { x: nameX, y: ruleY }, end: { x: PAGE_W - MARGIN_X, y: ruleY }, thickness: 1.5, color: TAN });
    p.drawCircle({ x: nameX, y: ruleY, size: 2.6, color: TAN });
    p.drawCircle({ x: PAGE_W - MARGIN_X, y: ruleY, size: 2.6, color: TAN });
    // tagline
    p.drawText("Always", { x: nameX, y: top - 40, size: 9.5, font: this.italic, color: INK });
    p.drawText("on time", { x: nameX + this.italic.widthOfTextAtSize("Always ", 9.5), y: top - 40, size: 9.5, font: this.bold, color: INK });
    // meta row (centered): GST box | phone | email
    const metaY = top - 58;
    const size = 8.3;
    const gst = `GST No: ${C.gst}`;
    const phone = `Tel: ${C.phone}`;
    const email = `Email: ${C.email}`;
    const gstW = this.regular.widthOfTextAtSize(gst, size) + 14;
    const phoneW = this.regular.widthOfTextAtSize(phone, size);
    const emailW = this.regular.widthOfTextAtSize(email, size);
    const gap = 16;
    const total = gstW + gap + 1 + gap + phoneW + gap + 1 + gap + emailW;
    let x = (PAGE_W - total) / 2;
    p.drawRectangle({ x, y: metaY - 4.5, width: gstW, height: 15, borderColor: TAN, borderWidth: 1, color: rgb(1, 1, 1) });
    p.drawText(safe(gst), { x: x + 7, y: metaY, size, font: this.regular, color: INK });
    x += gstW + gap;
    p.drawLine({ start: { x, y: metaY - 3 }, end: { x, y: metaY + 9 }, thickness: 1, color: TAN });
    x += 1 + gap;
    p.drawText(safe(phone), { x, y: metaY, size, font: this.regular, color: INK });
    x += phoneW + gap;
    p.drawLine({ start: { x, y: metaY - 3 }, end: { x, y: metaY + 9 }, thickness: 1, color: TAN });
    x += 1 + gap;
    p.drawText(safe(email), { x, y: metaY, size, font: this.regular, color: INK });
    // thin separator under the letterhead
    p.drawLine({ start: { x: MARGIN_X, y: PAGE_H - HEADER_H }, end: { x: PAGE_W - MARGIN_X, y: PAGE_H - HEADER_H }, thickness: 0.6, color: RULE });
  }

  private drawFooter(): void {
    const C = COMPANY_LETTERHEAD;
    const p = this.page;
    p.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_H, color: FOOT_BG });
    const size = 7.6;
    const label = "Office address : ";
    const addr = safe(C.address);
    // Center the (label + address) — wrap the address to two lines if needed.
    const maxW = PAGE_W - 40;
    const labelW = this.bold.widthOfTextAtSize(label, size);
    const lines = this.wrapPlain(addr, this.regular, size, maxW - labelW);
    let y = FOOTER_H / 2 + (lines.length > 1 ? 4 : -3);
    lines.forEach((ln, i) => {
      const w = (i === 0 ? labelW : 0) + this.regular.widthOfTextAtSize(ln, size);
      let x = (PAGE_W - w) / 2;
      if (i === 0) {
        p.drawText(label, { x, y, size, font: this.bold, color: INK });
        x += labelW;
      }
      p.drawText(ln, { x, y, size, font: this.regular, color: INK });
      y -= 9.5;
    });
    // page number + doc title, tiny, right side
    p.drawText(safe(`${this.footerTitle}  -  Page ${this.pageNo}`), {
      x: PAGE_W - MARGIN_X - this.regular.widthOfTextAtSize(safe(`${this.footerTitle}  -  Page ${this.pageNo}`), 6.5),
      y: FOOTER_H + 4,
      size: 6.5,
      font: this.regular,
      color: MUTED,
    });
  }

  // ── Layout primitives ─────────────────────────────────────────────────
  private wrapPlain(text: string, font: PDFFont, size: number, maxW: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) <= maxW || !cur) cur = t;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  private layoutRuns(text: string, size: number, maxW: number, baseBold = false): Line[] {
    const runs = parseRuns(text);
    const words: Word[] = [];
    for (const r of runs) {
      const bold = baseBold || r.bold;
      const font = bold ? this.bold : this.regular;
      const parts = safe(r.text).split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          words.push({ text: " ", bold, width: font.widthOfTextAtSize(" ", size) });
        } else {
          words.push({ text: part, bold, width: font.widthOfTextAtSize(part, size) });
        }
      }
    }
    const lines: Line[] = [];
    let cur: Word[] = [];
    let curW = 0;
    for (const w of words) {
      if (w.text === " " && cur.length === 0) continue; // no leading spaces
      if (curW + w.width > maxW && cur.length > 0 && w.text !== " ") {
        // trim trailing space
        while (cur.length && cur[cur.length - 1].text === " ") curW -= cur.pop()!.width;
        lines.push({ words: cur, width: curW });
        cur = [];
        curW = 0;
      }
      cur.push(w);
      curW += w.width;
    }
    while (cur.length && cur[cur.length - 1].text === " ") curW -= cur.pop()!.width;
    if (cur.length) lines.push({ words: cur, width: curW });
    return lines;
  }

  ensure(h: number): void {
    if (this.y - h < BOTTOM_Y) this.newPage();
  }

  space(h: number): void {
    this.y -= h;
  }

  private drawLine(line: Line, x: number, y: number, size: number, maxW: number, justify: boolean, color: RGB): void {
    // Justify: distribute extra width across the spaces (not on the last line).
    const spaces = line.words.filter((w) => w.text === " ").length;
    const extra = justify && spaces > 0 ? (maxW - line.width) / spaces : 0;
    let cx = x;
    for (const w of line.words) {
      if (w.text === " ") {
        cx += w.width + extra;
        continue;
      }
      this.page.drawText(w.text, { x: cx, y, size, font: w.bold ? this.bold : this.regular, color });
      cx += w.width;
    }
  }

  paragraph(text: string, opts: { size?: number; leading?: number; x?: number; maxW?: number; justify?: boolean; color?: RGB; after?: number; bold?: boolean } = {}): void {
    const size = opts.size ?? 8.8;
    const leading = opts.leading ?? size * 1.28;
    const x = opts.x ?? MARGIN_X;
    const maxW = opts.maxW ?? CONTENT_W - (x - MARGIN_X);
    const lines = this.layoutRuns(text, size, maxW, opts.bold ?? false);
    lines.forEach((ln, i) => {
      this.ensure(leading);
      this.y -= leading;
      this.drawLine(ln, x, this.y, size, maxW, (opts.justify ?? true) && i < lines.length - 1, opts.color ?? INK);
    });
    this.y -= opts.after ?? 3;
  }

  heading(text: string, opts: { size?: number; before?: number; after?: number } = {}): void {
    const size = opts.size ?? 9.2;
    this.ensure(size * 3);
    this.y -= opts.before ?? 5;
    this.y -= size;
    this.page.drawText(safe(text.toUpperCase()), { x: MARGIN_X, y: this.y, size, font: this.bold, color: INK });
    this.y -= opts.after ?? 2.5;
  }

  title(text: string, opts: { size?: number } = {}): void {
    const size = opts.size ?? 13.5;
    this.ensure(size * 2.5);
    this.y -= size + 2;
    const w = this.bold.widthOfTextAtSize(text, size);
    const x = (PAGE_W - w) / 2;
    this.page.drawText(safe(text), { x, y: this.y, size, font: this.bold, color: INK });
    this.page.drawLine({ start: { x, y: this.y - 3 }, end: { x: x + w, y: this.y - 3 }, thickness: 1, color: INK });
    this.y -= 6;
  }

  centered(text: string, opts: { size?: number; color?: RGB; italic?: boolean } = {}): void {
    const size = opts.size ?? 8.8;
    const font = opts.italic ? this.italic : this.regular;
    this.ensure(size * 2);
    this.y -= size + 2;
    const w = font.widthOfTextAtSize(safe(text), size);
    this.page.drawText(safe(text), { x: (PAGE_W - w) / 2, y: this.y, size, font, color: opts.color ?? MUTED });
    this.y -= 4;
  }

  // Simple bold-label / value key table (no borders): used for the parties.
  kv(rows: [string, string][], opts: { size?: number; labelW?: number } = {}): void {
    const size = opts.size ?? 8.8;
    const labelW = opts.labelW ?? 132;
    const leading = size * 1.32;
    for (const [k, v] of rows) {
      const lines = this.layoutRuns(v, size, CONTENT_W - labelW);
      this.ensure(leading * Math.max(1, lines.length));
      lines.forEach((ln, i) => {
        this.y -= leading;
        if (i === 0) this.page.drawText(safe(k), { x: MARGIN_X, y: this.y, size, font: this.regular, color: MUTED });
        this.drawLine(ln, MARGIN_X + labelW, this.y, size, CONTENT_W - labelW, false, INK);
      });
    }
    this.y -= 4;
  }

  // Bordered two-column terms table.
  table(rows: [string, string][], opts: { size?: number; labelW?: number } = {}): void {
    const size = opts.size ?? 9.2;
    const labelW = opts.labelW ?? 150;
    const padX = 6;
    const padY = 4.5;
    const leading = size * 1.4;
    for (const [k, v] of rows) {
      const lines = this.layoutRuns(v, size, CONTENT_W - labelW - padX * 2);
      const rowH = Math.max(1, lines.length) * leading + padY * 2;
      this.ensure(rowH);
      const top = this.y;
      // backgrounds + borders
      this.page.drawRectangle({ x: MARGIN_X, y: top - rowH, width: labelW, height: rowH, color: TABLE_HEAD_BG, borderColor: RULE, borderWidth: 0.7 });
      this.page.drawRectangle({ x: MARGIN_X + labelW, y: top - rowH, width: CONTENT_W - labelW, height: rowH, borderColor: RULE, borderWidth: 0.7 });
      // label
      this.page.drawText(safe(k), { x: MARGIN_X + padX, y: top - padY - size, size, font: this.bold, color: INK });
      // value lines
      let yy = top - padY - size;
      for (const ln of lines) {
        this.drawLine(ln, MARGIN_X + labelW + padX, yy, size, CONTENT_W - labelW - padX * 2, false, INK);
        yy -= leading;
      }
      this.y = top - rowH;
    }
    this.y -= 6;
  }

  // The highlighted zero-tolerance clause: a red-bordered, tinted box holding
  // a title, paragraphs and a numbered list. Rendered as a stream of "rows"
  // that may CONTINUE across a page boundary: each page segment gets its own
  // red frame (a "continued" segment simply opens at the top of the next
  // page), so the box never leaves a huge gap at the bottom of a page and the
  // agreement stays at exactly two pages.
  alertBox(title: string, paras: string[], list: string[], foot: string): void {
    const size = 8.7;
    const leading = size * 1.3;
    const padX = 10;
    const x = MARGIN_X + padX + 4;
    const innerW = CONTENT_W - padX * 2 - 6;

    // Build the row stream: each row = { h, draw(yTop) } where draw renders the
    // row with its baseline computed from yTop.
    type Row = { h: number; draw: (yTop: number) => void };
    const rows: Row[] = [];
    rows.push({
      h: 8 + 11 + 6,
      draw: (yTop) => this.page.drawText(safe(title), { x, y: yTop - 8 - 11, size: 11, font: this.bold, color: RED_DARK }),
    });
    for (const p of paras) {
      const lines = this.layoutRuns(p, size, innerW);
      lines.forEach((ln, i) =>
        rows.push({ h: leading, draw: (yTop) => this.drawLine(ln, x, yTop - leading, size, innerW, i < lines.length - 1, INK) })
      );
      rows.push({ h: 3, draw: () => {} });
    }
    list.forEach((li, idx) => {
      const lines = this.layoutRuns(li, size, innerW - 14);
      lines.forEach((ln, i) =>
        rows.push({
          h: leading,
          draw: (yTop) => {
            if (i === 0) this.page.drawText(`${idx + 1}.`, { x, y: yTop - leading, size, font: this.bold, color: INK });
            this.drawLine(ln, x + 14, yTop - leading, size, innerW - 14, i < lines.length - 1, INK);
          },
        })
      );
      rows.push({ h: 1.5, draw: () => {} });
    });
    rows.push({ h: 3, draw: () => {} });
    const footLines = this.layoutRuns(foot, size - 0.4, innerW);
    for (const ln of footLines) {
      rows.push({
        h: leading,
        draw: (yTop) => {
          let cx = x;
          for (const w of ln.words) {
            if (w.text === " ") {
              cx += w.width;
              continue;
            }
            this.page.drawText(w.text, { x: cx, y: yTop - leading, size: size - 0.4, font: w.bold ? this.boldItalic : this.italic, color: INK });
            cx += w.width;
          }
        },
      });
    }
    rows.push({ h: 8, draw: () => {} });

    // Lay the rows out in page segments. For each segment: measure how many
    // rows fit, draw the frame FIRST (so text sits on top of the tint), then
    // the rows.
    let i = 0;
    // Never start the box with fewer than ~4 rows on a page (avoid a lonely
    // title at the bottom).
    const minStart = rows.slice(0, 5).reduce((s, r) => s + r.h, 0);
    this.ensure(minStart);
    while (i < rows.length) {
      const top = this.y;
      const avail = top - BOTTOM_Y;
      let j = i;
      let segH = 0;
      while (j < rows.length && segH + rows[j].h <= avail) {
        segH += rows[j].h;
        j++;
      }
      if (j === i) {
        // Not even one row fits — new page and retry.
        this.newPage();
        continue;
      }
      // frame for this segment
      this.page.drawRectangle({ x: MARGIN_X, y: top - segH, width: CONTENT_W, height: segH, color: RED_BG, borderColor: RED, borderWidth: 1.6 });
      this.page.drawRectangle({ x: MARGIN_X, y: top - segH, width: 6, height: segH, color: RED });
      let yTop = top;
      for (let k = i; k < j; k++) {
        rows[k].draw(yTop);
        yTop -= rows[k].h;
      }
      this.y = top - segH;
      i = j;
      if (i < rows.length) this.newPage();
    }
    this.y -= 6;
  }

  // Signature blocks (+ optional witness line) are measured and kept together
  // as ONE unit so they can never split across pages.
  signatures(
    left: { role: string; name: string; sub: string },
    right: { role: string; name: string; sub: string },
    opts: { gapAbove?: number; witnesses?: boolean } = {}
  ): void {
    const gap = opts.gapAbove ?? 18;
    const signH = 26 + 34; // space above the line (for the signature) + labels under it
    const witH = opts.witnesses ? 22 : 0;
    this.ensure(gap + signH + witH);
    this.y -= gap;
    const colW = (CONTENT_W - 40) / 2;
    const cols = [
      { x: MARGIN_X, ...left },
      { x: MARGIN_X + colW + 40, ...right },
    ];
    const lineY = this.y - 26;
    for (const c of cols) {
      this.page.drawLine({ start: { x: c.x, y: lineY }, end: { x: c.x + colW, y: lineY }, thickness: 1, color: INK });
      this.page.drawText(safe(c.role), { x: c.x, y: lineY - 11, size: 9, font: this.bold, color: INK });
      this.page.drawText(safe(c.name), { x: c.x, y: lineY - 22, size: 9, font: this.regular, color: INK });
      this.page.drawText(safe(c.sub), { x: c.x, y: lineY - 32, size: 8, font: this.regular, color: MUTED });
    }
    this.y = lineY - 34;
    if (opts.witnesses) {
      this.y -= 14;
      const size = 9;
      this.page.drawText("Witness 1: ______________________________", { x: MARGIN_X, y: this.y, size, font: this.regular, color: INK });
      const t = "Witness 2: ______________________________";
      this.page.drawText(t, { x: PAGE_W - MARGIN_X - this.regular.widthOfTextAtSize(t, size), y: this.y, size, font: this.regular, color: INK });
      this.y -= 8;
    }
  }

  async bytes(): Promise<Uint8Array> {
    return this.pdf.save();
  }
}

// ── Shared vars ────────────────────────────────────────────────────────────
function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}
function vars(input: OfferLetterInput) {
  const C = COMPANY_LETTERHEAD;
  return {
    C,
    name: input.candidateName.trim(),
    currency: input.salaryCurrency?.trim() || "INR",
    probation: input.probationMonths ?? 3,
    notice: input.noticeDays ?? 30,
    employmentType: input.employmentType?.trim() || "Full-time",
    workingHours: input.workingHours?.trim() || "as per the shift schedule assigned by the Company (international / US-hours process)",
    workLocation: input.workLocation?.trim() || `${C.shortName}, ${C.city}`,
    hrName: input.hrSignatoryName?.trim() || "Authorised Signatory",
    hrTitle: input.hrSignatoryTitle?.trim() || "Human Resources",
    addressOneLine: (input.candidateAddress || "").replace(/\r?\n/g, ", ").replace(/\s+,/g, ",").trim(),
  };
}

// ── Document 1: Offer of Employment ─────────────────────────────────────────
export async function renderOfferLetterPdf(input: OfferLetterInput): Promise<Uint8Array> {
  const v = vars(input);
  const d = await Doc.create(`Offer Letter - ${v.name}`);

  // Ref + date row
  {
    const size = 9.4;
    d.y -= size + 2;
    if (input.referenceNo) d.page.drawText(safe(`Ref: ${input.referenceNo}`), { x: MARGIN_X, y: d.y, size, font: d.regular, color: INK });
    const dt = `Date: ${fmtDate(input.letterDate)}`;
    d.page.drawText(safe(dt), { x: PAGE_W - MARGIN_X - d.regular.widthOfTextAtSize(safe(dt), size), y: d.y, size, font: d.regular, color: INK });
    d.y -= 10;
  }

  // Addressee
  d.paragraph("**To,**", { after: 0, justify: false });
  d.paragraph(`**${v.name}**`, { after: 0, justify: false });
  if (input.fatherOrGuardianName) d.paragraph(`S/o, D/o, W/o: ${input.fatherOrGuardianName}`, { after: 0, justify: false });
  for (const ln of (input.candidateAddress || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) d.paragraph(ln, { after: 0, justify: false });
  if (input.candidatePhone) d.paragraph(`Phone: ${input.candidatePhone}`, { after: 0, justify: false });
  if (input.candidateEmail) d.paragraph(`Email: ${input.candidateEmail}`, { after: 0, justify: false });
  d.space(8);

  d.title("OFFER OF EMPLOYMENT");
  d.space(4);
  d.paragraph(`**Subject:** Offer for the position of **${input.designation}**`, { justify: false, after: 8 });
  d.paragraph(`Dear ${v.name},`, { justify: false, after: 6 });
  d.paragraph(
    `Further to your interview and subsequent discussions with us, we are pleased to offer you employment with **${v.C.shortName}** (hereinafter "the Company") on the following terms and conditions:`,
    { after: 8 }
  );

  const rows: [string, string][] = [
    ["Position", `${input.designation}${input.department ? ` - ${input.department}` : ""}`],
    ["Nature of employment", v.employmentType],
    ["Date of joining", fmtDate(input.joiningDate)],
    ["Place of work", v.workLocation],
    ["Working hours", v.workingHours],
    ["Monthly salary", `**${v.currency} ${input.monthlySalary}** per month (gross)${input.incentiveNote ? `, ${input.incentiveNote}` : ""}`],
  ];
  if (input.reportingTo) rows.push(["Reporting to", input.reportingTo]);
  rows.push(["Probation", `${v.probation} month${v.probation === 1 ? "" : "s"} from the date of joining, extendable at the Company's discretion`]);
  rows.push(["Notice period", `${v.notice} days (either side) after confirmation; during probation, 7 days' notice by either party`]);
  d.table(rows);

  d.paragraph(
    `This offer is subject to (a) satisfactory verification of the documents you submit (identity, address, educational and prior-employment records) and (b) your signing of the **Employment & Data Protection Agreement** issued along with this letter, which forms an integral part of your terms of employment. Salary is payable monthly in arrears, subject to statutory deductions, and is confidential between you and the Company.`
  );
  d.paragraph(
    `Your employment is governed by the Company's policies, rules and code of conduct as amended from time to time. Please sign and return the duplicate copy of this letter, together with the signed Agreement, as your acceptance on or before your date of joining.`
  );
  d.paragraph(`We welcome you to ${v.C.shortName} and look forward to a long and successful association.`, { after: 2 });

  d.signatures(
    { role: `For ${v.C.shortName}`, name: v.hrName, sub: v.hrTitle },
    { role: "Accepted by", name: v.name, sub: "Signature & date" },
    { gapAbove: 26 }
  );

  return d.bytes();
}

// ── Document 2: Employment & Data Protection Agreement (two pages) ───────────
export async function renderAgreementPdf(input: OfferLetterInput): Promise<Uint8Array> {
  const v = vars(input);
  const d = await Doc.create(`Employment Agreement - ${v.name}`);

  d.title("EMPLOYMENT & DATA PROTECTION AGREEMENT", { size: 12.5 });
  d.centered(`Dated ${fmtDate(input.letterDate)}${input.referenceNo ? `   |   Ref: ${input.referenceNo}` : ""}`);
  d.paragraph(
    `This Agreement is made between **${v.C.shortName}**, ${v.C.city} (registered office as per the letterhead) ("the Company"), and the employee whose particulars are given below ("the Employee"):`,
    { after: 1 }
  );
  const parties: [string, string][] = [["Name", `**${v.name}**`]];
  if (input.fatherOrGuardianName) parties.push(["Father's / Guardian's name", input.fatherOrGuardianName]);
  if (input.dateOfBirth) parties.push(["Date of birth", fmtDate(input.dateOfBirth)]);
  if (v.addressOneLine) parties.push(["Address", v.addressOneLine]);
  if (input.candidatePhone || input.candidateEmail) parties.push(["Contact", [input.candidatePhone, input.candidateEmail].filter(Boolean).join("  |  ")]);
  if (input.idType || input.idNumber) parties.push([`ID (${input.idType || "Govt. ID"})`, input.idNumber || ""]);
  parties.push(["Position", `${input.designation}${input.department ? `, ${input.department}` : ""} - ${v.employmentType}`]);
  parties.push(["Date of joining", fmtDate(input.joiningDate)]);
  d.kv(parties);

  d.heading("1. Nature of the business");
  d.paragraph(
    `The Company operates an international business process outsourcing (BPO) / call-centre operation. On behalf of its clients, the Employee will contact prospective customers, present and sell the clients' products and services (television, internet, telecommunications and related products), and process orders. In the course of this work the Employee will receive, hear or handle customers' personal and financial information.`
  );

  d.heading("2. Customer personal & financial information - the Employee's duty");
  d.paragraph(
    `2.1 "Customer Information" means any information relating to a customer or prospective customer: name, address, telephone number, email, date of birth, government identification or social security numbers, payment-card numbers, bank details, account credentials, and any order or verification details.`
  );
  d.paragraph(`2.2 Customer Information may be used **solely** to verify and place the customer's order with the client, at the time of the call, in accordance with the client's procedures.`);
  d.paragraph(
    `2.3 The Employee may note Customer Information only transiently (for example on a notepad) while verifying it, and **must delete and destroy every copy of it - written, typed, saved, photographed or otherwise - immediately after the order has been placed and the customer's service activated.** No Customer Information may be retained, stored, copied, photographed, forwarded, transmitted or taken out of the Company's premises or systems in any form, at any time, for any reason.`
  );
  d.paragraph(
    `2.4 **Deletion is the Employee's personal responsibility.** The Company provides the leads and the opportunity to place orders; the safekeeping and immediate destruction of Customer Information handled by the Employee is the Employee's own obligation, and the Employee confirms they alone control what they note, save or retain.`
  );
  d.paragraph(
    `2.5 Any misuse of Customer Information by the Employee - fraud, unauthorised transactions, identity theft, sharing or selling of information, or any use outside the client's order process - is a criminal act committed by the Employee in their individual capacity, wholly outside the scope of employment and against the Company's express instructions. **The Employee shall be solely and personally liable**, civilly and criminally, for any such act and for all loss, claims, penalties and legal costs arising from it, and shall indemnify and hold the Company harmless in full. The Company will cooperate with the authorities and affected parties in any such matter.`
  );

  d.heading("3. Company data, leads and confidentiality");
  d.paragraph(
    `3.1 "Company Data" means all leads (including any customer's name, telephone number, email or other details), lead lists, client information, sales records, scripts, pricing, systems access, reports and any other business information of the Company or its clients, in any form. 3.2 Company Data is the exclusive property of the Company. The Employee shall use it only for the Company's work, on the Company's systems, and keep it strictly confidential during and after employment.`,
    { after: 6 }
  );

  d.alertBox(
    "!  3.3  DATA THEFT - ZERO TOLERANCE",
    [
      `The Employee shall **NOT**, under any circumstances: transfer, send, forward, share, copy, upload, message, email, photograph, screenshot, write down for removal, or otherwise take **ANY Company Data outside the Company - not even a single lead** (a customer's name, number or email included) - to a personal device, personal email, cloud storage, messaging application, social-media account, another person, or any third party.`,
      `The Employee shall **NOT** use personal Instagram, Facebook, WhatsApp, Telegram or any social-media or messaging service, nor any personal mobile phone or camera, on the Company's computers, network or premises in relation to Company Data, and shall **NOT** take pictures, screenshots or recordings of any screen, document or data belonging to the Company or its clients.`,
      `**If the Employee is found doing, or attempting to do, any of the above, the following shall apply immediately:**`,
    ],
    [
      `**Immediate termination** of employment without notice.`,
      `**Forfeiture** of all salary, incentives, commissions and other amounts then due or accrued to the Employee, which stand forfeited to the Company as liquidated damages.`,
      `A **fine of INR 50,000 (Rupees Fifty Thousand) up to INR 1,00,000 (Rupees One Lakh)**, as determined by the Company according to the gravity of the breach, payable by the Employee on demand.`,
      `A **police complaint / FIR** and such civil and criminal action as the Company deems fit, including under the Information Technology Act, 2000 and the Indian Penal Code / Bharatiya Nyaya Sanhita.`,
    ],
    `The Employee acknowledges that these consequences are reasonable and proportionate to the harm such theft causes the Company and its clients, and agrees to them knowingly and voluntarily.`
  );

  // Sections 4–9 flow on naturally (the zero-tolerance box above continues
  // across the page boundary), landing the whole agreement on two pages.
  d.heading("4. Systems, monitoring and conduct", { before: 2 });
  d.paragraph(
    `4.1 The Employee shall use only Company-provided systems, credentials and tools for work, keep credentials secret, and not install unauthorised software or connect unauthorised devices. 4.2 The Employee acknowledges that the Company's systems, calls, screens and premises may be monitored and recorded for quality, security and compliance, and consents to such monitoring. 4.3 The Employee shall follow the client's calling scripts, disclosures and compliance requirements, treat customers courteously and honestly, and shall not misrepresent any product, price or term, nor place any order without the customer's clear consent.`
  );

  d.heading("5. Attendance, hours and leave");
  d.paragraph(
    `5.1 Working hours: ${v.workingHours}. The Employee shall report punctually for every scheduled shift; the Company may change shift timings with reasonable notice as client requirements demand. 5.2 Leave is granted as per the Company's leave policy and must be applied for and approved in advance; unapproved absence is treated as leave without pay. 5.3 Unauthorised absence for three (3) or more consecutive working days shall be treated as abandonment of service.`
  );

  d.heading("6. Salary, incentives and deductions");
  d.paragraph(
    `6.1 Salary is payable monthly in arrears, subject to statutory deductions and to attendance. 6.2 Incentives and commissions, where offered, are payable strictly as per the Company's incentive policy in force, on sales that are activated and not cancelled or charged back within the client's qualifying period, and are not payable for any period in which the Employee is in breach of this Agreement. 6.3 The Company may recover from any amount due to the Employee any advance, loss or damage caused by the Employee's negligence, misconduct or breach.`
  );

  d.heading("7. Confidentiality and non-solicitation");
  d.paragraph(
    `7.1 The Employee shall keep confidential, during and after employment, all Company Data, client identities, pricing, processes and any information not publicly known. 7.2 For twelve (12) months after leaving, the Employee shall not solicit or divert the Company's clients or customers, nor solicit the Company's employees to leave, and shall not use or disclose any Company Data or lead in any other business.`
  );

  d.heading("8. Termination");
  d.paragraph(
    `8.1 After confirmation, either party may end this employment by giving **${v.notice} days'** written notice or salary in lieu; during probation of ${v.probation} month${v.probation === 1 ? "" : "s"}, 7 days' notice applies. 8.2 The Company may terminate employment immediately, without notice or payment in lieu, for misconduct, dishonesty, breach of this Agreement or of confidentiality, poor performance after warning, or any act that brings the Company or its clients into disrepute. 8.3 On leaving for any reason, the Employee shall immediately return all Company property, data, documents and access credentials, retain no copy, and complete the exit formalities; final settlement is made only after clearance. 8.4 The obligations in Sections 2, 3 and 7 **survive** the end of employment indefinitely.`
  );

  d.heading("9. General");
  d.paragraph(
    `9.1 The Employee confirms that the particulars and documents given to the Company are true; any false statement or forged document is grounds for immediate termination. 9.2 This Agreement, together with the Offer of Employment and the Company's policies, is the entire agreement between the parties and may be amended only in writing signed by both. 9.3 This Agreement is governed by the laws of India; the courts at ${v.C.city}, Maharashtra shall have exclusive jurisdiction.`
  );

  d.heading("Declaration by the Employee");
  d.paragraph(
    `I, **${v.name}**, confirm that I have read and fully understood this Agreement (including Section 3.3 highlighted on the previous page), that it has been explained to me in a language I understand, and that I accept it of my own free will as a condition of my employment with ${v.C.shortName}.`
  );

  d.signatures(
    { role: "Employee", name: v.name, sub: "Signature & date" },
    { role: `For ${v.C.shortName}`, name: v.hrName, sub: `${v.hrTitle} - Signature & date` },
    { gapAbove: 14, witnesses: true }
  );

  return d.bytes();
}
