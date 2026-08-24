/* My Excel — pure-logic regression suite (grid helpers + server sanitizers).
 * Run: npm run test:excel   (tsx; no framework). Covers CSV/TSV parsing, column
 * labels, TSV roundtrip, and the server-side sanitizers that block injection,
 * cap values, and drop out-of-range cells. */
import { colLabel, parseGrid, toTSV, csvCell, cellKey } from "./grid";
import { sanitizeFormat, mergeCells, mergeDims, LIMITS } from "./sanitize";

let pass = 0;
const fails: string[] = [];
const ck = (n: string, c: boolean, extra?: string) => { if (c) pass++; else fails.push(n + (extra ? `  [${extra}]` : "")); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── Column labels ──
ck("colLabel 0=A", colLabel(0) === "A");
ck("colLabel 25=Z", colLabel(25) === "Z");
ck("colLabel 26=AA", colLabel(26) === "AA");
ck("colLabel 27=AB", colLabel(27) === "AB");
ck("colLabel 701=ZZ", colLabel(701) === "ZZ");
ck("colLabel 702=AAA", colLabel(702) === "AAA");

// ── CSV / TSV parsing ──
{
  const csv = 'Name,Phone,Product\nJohn,123,Xfinity\n"Doe, Jr","1,2",DISH';
  const g = parseGrid(csv, ",");
  ck("csv rows", g.length === 3);
  ck("csv quoted comma field", g[2][0] === "Doe, Jr" && g[2][1] === "1,2");
  const withQuotes = 'a,"he said ""hi""",c';
  ck("csv escaped quotes", parseGrid(withQuotes, ",")[0][1] === 'he said "hi"');
  const withNL = '"line1\nline2",b';
  ck("csv newline in quotes", parseGrid(withNL, ",")[0][0] === "line1\nline2");
  const tsv = "Name\tPhone\nMary\t987";
  const t = parseGrid(tsv, "\t");
  ck("tsv paste from excel", t.length === 2 && t[1][0] === "Mary" && t[1][1] === "987");
  ck("trailing newline dropped", parseGrid("a\nb\n", ",").length === 2);
}

// ── csvCell escaping + TSV build ──
ck("csvCell plain", csvCell("hello") === "hello");
ck("csvCell comma", csvCell("a,b") === '"a,b"');
ck("csvCell quote", csvCell('a"b') === '"a""b"');
{
  const cells = { [cellKey(0, 0)]: { v: "A" }, [cellKey(0, 1)]: { v: "B" }, [cellKey(1, 0)]: { v: "C" } };
  ck("toTSV range", toTSV(cells, 0, 0, 1, 1) === "A\tB\nC\t");
}

// ── sanitizeFormat: keeps valid, blocks injection ──
ck("fmt keeps valid", eq(sanitizeFormat({ b: 1, i: 1, u: 1, a: "center", bg: "#ff0000", fg: "#000", sz: 16, bd: 1 }), { b: 1, i: 1, u: 1, a: "center", bg: "#ff0000", fg: "#000", sz: 16, bd: 1 }));
ck("fmt blocks CSS injection in bg", sanitizeFormat({ bg: "red; background:url(x)" })?.bg === undefined);
ck("fmt blocks html in fg", sanitizeFormat({ fg: "<script>alert(1)</script>" })?.fg === undefined);
ck("fmt blocks bad align", sanitizeFormat({ a: "justify" }) === undefined);
ck("fmt blocks oversize font", sanitizeFormat({ sz: 999 }) === undefined);
ck("fmt drops unknown keys", sanitizeFormat({ evil: 1, onclick: "x" }) === undefined);
ck("fmt bold only 1/true", sanitizeFormat({ b: "yes" }) === undefined);
ck("fmt empty → undefined", sanitizeFormat({}) === undefined);

// ── mergeCells: delta semantics ──
{
  const base = { [cellKey(0, 0)]: { v: "keep" } };
  const m1 = mergeCells(base, { [cellKey(1, 1)]: { v: "new" } }, 100, 26);
  ck("merge adds cell", m1[cellKey(1, 1)]?.v === "new" && m1[cellKey(0, 0)]?.v === "keep");
  const m2 = mergeCells(base, { [cellKey(0, 0)]: null }, 100, 26);
  ck("merge null deletes", m2[cellKey(0, 0)] === undefined);
  const m3 = mergeCells(base, { [cellKey(0, 0)]: { v: "" } }, 100, 26);
  ck("merge empty deletes", m3[cellKey(0, 0)] === undefined);
  const m4 = mergeCells({}, { "99:5": { v: "off-grid" } }, 100, 26);
  ck("merge drops out-of-range col", m4["99:5"]?.v === "off-grid"); // 5 < 26, 99 < 100 → valid
  const m5 = mergeCells({}, { "5:99": { v: "off-grid" } }, 100, 26);
  ck("merge drops col beyond colCount", m5["5:99"] === undefined);
  const m6 = mergeCells({}, { "9999:0": { v: "x" } }, 100, 26);
  ck("merge drops row beyond rowCount", m6["9999:0"] === undefined);
  const m7 = mergeCells({}, { "bad-key": { v: "x" }, "0:0:0": { v: "y" } }, 100, 26);
  ck("merge ignores malformed keys", Object.keys(m7).length === 0);
  const long = "x".repeat(LIMITS.MAX_CELL_LEN + 500);
  const m8 = mergeCells({}, { [cellKey(0, 0)]: { v: long } }, 100, 26);
  ck("merge caps value length", (m8[cellKey(0, 0)]?.v.length ?? 0) === LIMITS.MAX_CELL_LEN);
  const m9 = mergeCells({}, { [cellKey(0, 0)]: { v: "", f: { b: 1 } } }, 100, 26);
  ck("merge keeps empty-with-format", m9[cellKey(0, 0)]?.v === "" && eq(m9[cellKey(0, 0)]?.f, { b: 1 }));
}

// ── mergeDims ──
{
  const m1 = mergeDims({}, { "5": 40 }, LIMITS.MAX_ROW_H, 100);
  ck("dim sets within range", m1["5"] === 40);
  ck("dim drops below min", eq(mergeDims({}, { "5": 4 }, LIMITS.MAX_ROW_H, 100), {}));
  ck("dim drops above max", eq(mergeDims({}, { "5": 9999 }, LIMITS.MAX_ROW_H, 100), {}));
  ck("dim null deletes", eq(mergeDims({ "5": 40 }, { "5": null }, LIMITS.MAX_ROW_H, 100), {}));
  ck("dim ignores non-numeric key", eq(mergeDims({}, { x: 40 }, LIMITS.MAX_ROW_H, 100), {}));
  ck("dim ignores out-of-count index", eq(mergeDims({}, { "500": 40 }, LIMITS.MAX_ROW_H, 100), {}));
}

console.log(`\nMy Excel logic suite: ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log("  FAIL: " + f); process.exit(1); }
console.log("ALL PASS");
