// My Excel — PURE server-side sanitizers + delta merge (no I/O), so the same
// policy is unit-testable and enforced on every save regardless of what the
// client sends. Colors are restricted to #hex (blocks CSS/HTML injection),
// values are length-capped, dimensions are bounded, and out-of-range cell keys
// are dropped.

export const LIMITS = {
  MAX_SHEETS: 50,
  MAX_ROWS: 5000,
  MAX_COLS: 200,
  MAX_CELL_LEN: 10_000,
  MAX_CELLS_PER_SAVE: 20_000,
  MAX_NAME_LEN: 120,
  MIN_DIM: 16,
  MAX_ROW_H: 400,
  MAX_COL_W: 800,
} as const;

const FMT_KEYS = new Set(["b", "i", "u", "w", "a", "bg", "fg", "sz", "bd"]);
export function sanitizeFormat(f: unknown): Record<string, unknown> | undefined {
  if (!f || typeof f !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
    if (!FMT_KEYS.has(k)) continue;
    if (k === "b" || k === "i" || k === "u" || k === "bd" || k === "w") {
      if (v === 1 || v === true) out[k] = 1;
    } else if (k === "a") {
      if (v === "left" || v === "center" || v === "right") out[k] = v;
    } else if (k === "bg" || k === "fg") {
      if (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v)) out[k] = v;
    } else if (k === "sz") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 8 && n <= 72) out[k] = Math.round(n);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export function mergeCells(
  current: Record<string, { v: string; f?: Record<string, unknown> }>,
  delta: Record<string, unknown>,
  rowCount: number,
  colCount: number
): Record<string, { v: string; f?: Record<string, unknown> }> {
  const next = { ...current };
  for (const [key, raw] of Object.entries(delta)) {
    const m = /^(\d+):(\d+)$/.exec(key);
    if (!m) continue;
    const r = Number(m[1]);
    const c = Number(m[2]);
    if (r < 0 || c < 0 || r >= rowCount || c >= colCount) continue;
    if (raw === null || raw === undefined) {
      delete next[key];
      continue;
    }
    const cell = raw as { v?: unknown; f?: unknown };
    const v = cell.v === undefined || cell.v === null ? "" : String(cell.v).slice(0, LIMITS.MAX_CELL_LEN);
    const f = sanitizeFormat(cell.f);
    if (v === "" && !f) {
      delete next[key];
      continue;
    }
    next[key] = f ? { v, f } : { v };
  }
  return next;
}

export function mergeDims(current: Record<string, number>, delta: Record<string, unknown>, max: number, count: number): Record<string, number> {
  const next = { ...current };
  for (const [key, raw] of Object.entries(delta)) {
    if (!/^\d+$/.test(key) || Number(key) >= count) continue;
    if (raw === null) {
      delete next[key];
      continue;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= LIMITS.MIN_DIM && n <= max) next[key] = Math.round(n);
  }
  return next;
}
