// My Excel — PURE grid helpers shared by the page and the tests (no React, no
// I/O): cell keys, column labels, and CSV/TSV parsing + serialization for
// clipboard, import and export.

export const cellKey = (r: number, c: number) => `${r}:${c}`;

// 0 -> "A", 25 -> "Z", 26 -> "AA", …
export function colLabel(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function toTSV(cells: Record<string, { v: string }>, r1: number, c1: number, r2: number, c2: number): string {
  const lines: string[] = [];
  for (let r = r1; r <= r2; r++) {
    const row: string[] = [];
    for (let c = c1; c <= c2; c++) row.push(cells[cellKey(r, c)]?.v ?? "");
    lines.push(row.join("\t"));
  }
  return lines.join("\n");
}

// Minimal CSV/TSV parser with quote support (for import + pasted clipboard data).
export function parseGrid(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      /* skip */
    } else field += ch;
  }
  row.push(field);
  rows.push(row);
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

export const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
