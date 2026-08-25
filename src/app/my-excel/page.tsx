"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cellKey as key, colLabel, toTSV, parseGrid } from "@/lib/excel/grid";

// Ziplod — My Excel. A lightweight, fast, personal spreadsheet (separate from
// the Sales Ledger). One workbook per user, many sheets. The grid renders cells
// as plain divs and edits through a SINGLE overlay <input> (only one cell edits
// at a time), so typing latency is the browser's own regardless of grid size.
// Autosave is DELTA-based: only changed cells are sent, merged server-side into
// the sheet's sparse jsonb, version-guarded. All data is company + user scoped.

type Fmt = { b?: 1; i?: 1; u?: 1; w?: 1; a?: "left" | "center" | "right"; bg?: string; fg?: string; sz?: number; bd?: 1 };
type Cell = { v: string; f?: Fmt };
type Cells = Record<string, Cell>;
type Dims = Record<string, number>;
type SheetMeta = { id: string; name: string; position: number };
type Status = "loading" | "saved" | "saving" | "dirty" | "offline" | "error";

const DEF_ROW_H = 24;
const DEF_COL_W = 96;
const ROWNUM_W = 46;
const HEADER_H = 24;


const EMPTY_ROW: Record<number, Cell> = {};
function sameRow(a: Record<number, Cell>, b: Record<number, Cell>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k as unknown as number] !== b[k as unknown as number]) return false;
  return true;
}

// One memoized row. Re-renders ONLY when its own data or selection state
// changes — so arrow-key navigation touches just the 2 affected rows instead
// of the whole grid, which is what makes editing feel native-fast.
type RowProps = {
  r: number;
  colCount: number;
  height: number;
  rowCells: Record<number, Cell>;
  rowSelected: boolean;
  selLeft: number;
  selRight: number;
  activeCol: number;
  editingCol: number;
  editSeed: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onDown: (r: number, c: number, shift: boolean) => void;
  onEnter: (r: number, c: number, buttons: number) => void;
  onDbl: (r: number, c: number) => void;
  onRowNum: (r: number) => void;
  onRowResize: (r: number, clientY: number, base: number) => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
  onEditBlur: () => void;
};
function gridRowEqual(a: RowProps, b: RowProps): boolean {
  return (
    a.r === b.r && a.colCount === b.colCount && a.height === b.height &&
    a.rowSelected === b.rowSelected && a.selLeft === b.selLeft && a.selRight === b.selRight &&
    a.activeCol === b.activeCol && a.editingCol === b.editingCol && a.editSeed === b.editSeed &&
    sameRow(a.rowCells, b.rowCells)
  );
}
const GridRow = memo(function GridRow(props: RowProps) {
  const { r, colCount, height, rowCells, rowSelected, selLeft, selRight, activeCol, editingCol, editSeed, editInputRef, onDown, onEnter, onDbl, onRowNum, onRowResize, onEditKeyDown, onEditBlur } = props;
  const tds: React.ReactNode[] = [];
  for (let c = 0; c < colCount; c++) {
    const cell = rowCells[c];
    const f = cell?.f;
    const active = c === activeCol;
    const selected = selLeft >= 0 && c >= selLeft && c <= selRight;
    const isEditing = c === editingCol;
    const style: React.CSSProperties = {
      fontWeight: f?.b ? 700 : undefined,
      fontStyle: f?.i ? "italic" : undefined,
      textDecoration: f?.u ? "underline" : undefined,
      textAlign: f?.a || undefined,
      background: f?.bg || undefined,
      color: f?.fg || undefined,
      fontSize: f?.sz ? `${f.sz}px` : undefined,
      boxShadow: f?.bd ? "inset 0 0 0 1px #64748b" : undefined,
    };
    tds.push(
      <td
        key={c}
        id={`cell-${r}-${c}`}
        className={`border border-slate-200 px-1 text-[13px] leading-tight ${f?.w ? "whitespace-pre-wrap break-words align-top" : "overflow-hidden whitespace-nowrap"} ${selected ? "bg-emerald-50" : ""} ${active ? "outline outline-2 outline-emerald-500 -outline-offset-2 relative z-[5]" : ""}`}
        style={style}
        onMouseDown={(e) => onDown(r, c, e.shiftKey)}
        onMouseEnter={(e) => onEnter(r, c, e.buttons)}
        onDoubleClick={() => onDbl(r, c)}
      >
        {isEditing ? (
          <input ref={editInputRef} defaultValue={editSeed} onKeyDown={onEditKeyDown} onBlur={onEditBlur} className="w-full h-full outline-none bg-white text-[13px] px-0" style={{ textAlign: f?.a || undefined }} />
        ) : (
          cell?.v ?? ""
        )}
      </td>
    );
  }
  return (
    <tr style={{ height }}>
      <th
        className={`sticky left-0 z-10 border border-slate-300 text-[11px] font-medium text-slate-600 text-center relative ${rowSelected ? "bg-emerald-100" : "bg-slate-100"}`}
        style={{ width: ROWNUM_W }}
        onClick={() => onRowNum(r)}
      >
        {r + 1}
        <span className="absolute bottom-0 left-0 w-full h-1.5 cursor-row-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onRowResize(r, e.clientY, height); }} />
      </th>
      {tds}
    </tr>
  );
}, gridRowEqual);

export default function MyExcelPage() {
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cells, setCells] = useState<Cells>({});
  const [rowHeights, setRowHeights] = useState<Dims>({});
  const [colWidths, setColWidths] = useState<Dims>({});
  const [rowCount, setRowCount] = useState(100);
  const [colCount, setColCount] = useState(26);
  const [status, setStatus] = useState<Status>("loading");
  const [fatal, setFatal] = useState("");
  const [sel, setSel] = useState({ r: 0, c: 0, r2: 0, c2: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number; seed: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  const [notice, setNotice] = useState("");
  const [painterOn, setPainterOn] = useState(false); // Format Painter armed?

  // Refs mirror state for use inside event handlers (no stale closures).
  const cellsRef = useRef<Cells>({});
  const rowHRef = useRef<Dims>({});
  const colWRef = useRef<Dims>({});
  const rowCountRef = useRef(100);
  const colCountRef = useRef(26);
  const selRef = useRef(sel);
  const editingRef = useRef(editing);
  const versionRef = useRef(1);
  const activeIdRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Pending delta accumulators (what still needs saving).
  const pCells = useRef<Record<string, Cell | null>>({});
  const pRowH = useRef<Record<string, number | null>>({});
  const pColW = useRef<Record<string, number | null>>({});
  const pCounts = useRef<{ rowCount?: number; colCount?: number }>({});
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undo / redo stacks of cell operations { key: {before, after} }.
  const undoStack = useRef<Array<Record<string, { before: Cell | null; after: Cell | null }>>>([]);
  const redoStack = useRef<typeof undoStack.current>([]);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(""), 4000);
  };
  const setCellsBoth = useCallback((next: Cells) => { cellsRef.current = next; setCells(next); }, []);
  const setSelBoth = useCallback((sv: { r: number; c: number; r2: number; c2: number }) => { selRef.current = sv; setSel(sv); }, []);
  const norm = (s: typeof sel) => ({ r1: Math.min(s.r, s.r2), c1: Math.min(s.c, s.c2), r2: Math.max(s.r, s.r2), c2: Math.max(s.c, s.c2) });

  // ── Load workbook + first sheet ──
  const loadSheet = useCallback(async (id: string) => {
    setStatus("loading");
    const res = await fetch(`/api/my-excel/sheets/${id}`, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) { flash("That sheet no longer exists."); return; }
      setStatus("error");
      return;
    }
    const { sheet } = await res.json();
    cellsRef.current = sheet.cells || {};
    rowHRef.current = sheet.rowHeights || {};
    colWRef.current = sheet.colWidths || {};
    rowCountRef.current = sheet.rowCount;
    colCountRef.current = sheet.colCount;
    versionRef.current = sheet.version;
    setCells(cellsRef.current);
    setRowHeights(rowHRef.current);
    setColWidths(colWRef.current);
    setRowCount(sheet.rowCount);
    setColCount(sheet.colCount);
    pCells.current = {}; pRowH.current = {}; pColW.current = {}; pCounts.current = {};
    dirtyRef.current = false;
    undoStack.current = []; redoStack.current = [];
    setSelBoth({ r: 0, c: 0, r2: 0, c2: 0 });
    setStatus("saved");
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/my-excel", { cache: "no-store" });
      if (res.status === 401) return setFatal("Please sign in to Ziplod first, then reopen My Excel.");
      if (res.status === 403) return setFatal((await res.json().catch(() => ({}))).error || "You do not have access to My Excel.");
      if (!res.ok) return setFatal("Could not load My Excel. Check your connection and reload.");
      const d = await res.json();
      const list: SheetMeta[] = d.sheets || [];
      setSheets(list);
      if (list[0]) { activeIdRef.current = list[0].id; setActiveId(list[0].id); await loadSheet(list[0].id); }
    })();
  }, [loadSheet]);

  // ── Save (delta, debounced, serialized, version-guarded) ──
  const save = useCallback(async () => {
    if (savingRef.current || !dirtyRef.current) return;
    const id = activeIdRef.current;
    if (!id) return;
    if (!navigator.onLine) return setStatus("offline");
    savingRef.current = true;
    dirtyRef.current = false;
    const batchCells = pCells.current; pCells.current = {};
    const batchRowH = pRowH.current; pRowH.current = {};
    const batchColW = pColW.current; pColW.current = {};
    const batchCounts = pCounts.current; pCounts.current = {};
    setStatus("saving");
    const body: Record<string, unknown> = { version: versionRef.current };
    if (Object.keys(batchCells).length) body.cells = batchCells;
    if (Object.keys(batchRowH).length) body.rowHeights = batchRowH;
    if (Object.keys(batchColW).length) body.colWidths = batchColW;
    if (batchCounts.rowCount !== undefined) body.rowCount = batchCounts.rowCount;
    if (batchCounts.colCount !== undefined) body.colCount = batchCounts.colCount;
    try {
      const res = await fetch(`/api/my-excel/sheets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 409) {
        // Another tab won — adopt its copy, then re-overlay this batch (this
        // tab's edits win) and re-queue so nothing is lost.
        const d = await res.json();
        const merged: Cells = { ...(d.cells || {}) };
        for (const [k, val] of Object.entries(batchCells)) { if (val === null) delete merged[k]; else merged[k] = val; }
        cellsRef.current = merged; setCells(merged);
        rowHRef.current = { ...(d.rowHeights || {}) }; setRowHeights(rowHRef.current);
        colWRef.current = { ...(d.colWidths || {}) }; setColWidths(colWRef.current);
        rowCountRef.current = d.rowCount; setRowCount(d.rowCount);
        colCountRef.current = d.colCount; setColCount(d.colCount);
        versionRef.current = d.version;
        pCells.current = { ...batchCells, ...pCells.current };
        dirtyRef.current = true;
        flash("This sheet was open in another tab — merged the latest copy.");
        setStatus("dirty");
        return;
      }
      if (!res.ok) throw new Error();
      const d = await res.json();
      versionRef.current = d.version;
      setStatus(dirtyRef.current ? "dirty" : "saved");
    } catch {
      // Re-queue the batch so the retry loop saves it.
      pCells.current = { ...batchCells, ...pCells.current };
      Object.assign(pRowH.current, batchRowH);
      Object.assign(pColW.current, batchColW);
      if (batchCounts.rowCount !== undefined && pCounts.current.rowCount === undefined) pCounts.current.rowCount = batchCounts.rowCount;
      if (batchCounts.colCount !== undefined && pCounts.current.colCount === undefined) pCounts.current.colCount = batchCounts.colCount;
      dirtyRef.current = true;
      setStatus(navigator.onLine ? "error" : "offline");
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) { if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(save, 800); }
    }
  }, []);

  const scheduleSave = () => {
    dirtyRef.current = true;
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 600);
  };
  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    while (savingRef.current) await new Promise((r) => setTimeout(r, 30));
    if (dirtyRef.current && navigator.onLine) await save();
    while (savingRef.current) await new Promise((r) => setTimeout(r, 30));
  }, [save]);

  // Offline / reconnect / close-guard.
  useEffect(() => {
    const onOnline = () => { if (dirtyRef.current) save(); else setStatus((s) => (s === "offline" ? "saved" : s)); };
    const onOffline = () => setStatus("offline");
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current || savingRef.current) e.preventDefault(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeunload", onUnload);
    const retry = setInterval(() => { if (dirtyRef.current && !savingRef.current && navigator.onLine) save(); }, 4000);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); window.removeEventListener("beforeunload", onUnload); clearInterval(retry); };
  }, [save]);

  // ── The one mutation path: apply cell changes (undoable) + queue delta ──
  const applyCells = useCallback((changes: Record<string, Cell | null>, undoable = true) => {
    const next = { ...cellsRef.current };
    const op: Record<string, { before: Cell | null; after: Cell | null }> = {};
    for (const [k, val] of Object.entries(changes)) {
      const before = cellsRef.current[k] ?? null;
      op[k] = { before, after: val };
      if (val === null) delete next[k]; else next[k] = val;
      pCells.current[k] = val;
    }
    setCellsBoth(next);
    if (undoable) { undoStack.current.push(op); if (undoStack.current.length > 200) undoStack.current.shift(); redoStack.current = []; }
    scheduleSave();
  }, []);

  const doUndo = () => {
    const op = undoStack.current.pop();
    if (!op) return;
    const next = { ...cellsRef.current };
    for (const [k, { before }] of Object.entries(op)) { if (before === null) delete next[k]; else next[k] = before; pCells.current[k] = before; }
    setCellsBoth(next);
    redoStack.current.push(op);
    scheduleSave();
  };
  const doRedo = () => {
    const op = redoStack.current.pop();
    if (!op) return;
    const next = { ...cellsRef.current };
    for (const [k, { after }] of Object.entries(op)) { if (after === null) delete next[k]; else next[k] = after; pCells.current[k] = after; }
    setCellsBoth(next);
    undoStack.current.push(op);
    scheduleSave();
  };

  // ── Editing ──
  const startEdit = useCallback((r: number, c: number, seed?: string) => {
    const initial = seed !== undefined ? seed : cellsRef.current[key(r, c)]?.v ?? "";
    editingRef.current = { r, c, seed: initial };
    setEditing({ r, c, seed: initial });
    requestAnimationFrame(() => { const el = editInputRef.current; if (el) { el.focus(); if (seed === undefined) el.select(); else el.setSelectionRange(el.value.length, el.value.length); } });
  }, []);
  const commitEdit = useCallback((moveTo?: { r: number; c: number }) => {
    const ed = editingRef.current;
    if (ed) {
      const v = editInputRef.current?.value ?? "";
      const cur = cellsRef.current[key(ed.r, ed.c)];
      if ((cur?.v ?? "") !== v) applyCells({ [key(ed.r, ed.c)]: v === "" ? (cur?.f ? { v: "", f: cur.f } : null) : { v, ...(cur?.f ? { f: cur.f } : {}) } });
      editingRef.current = null;
      setEditing(null);
    }
    if (moveTo) setSelBoth({ r: moveTo.r, c: moveTo.c, r2: moveTo.r, c2: moveTo.c });
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [applyCells, setSelBoth]);
  const cancelEdit = useCallback(() => { editingRef.current = null; setEditing(null); requestAnimationFrame(() => gridRef.current?.focus()); }, []);

  // Stable per-cell handlers so memoized rows don't re-render on navigation.
  const onCellDown = useCallback((r: number, c: number, shift: boolean) => {
    if (editingRef.current) commitEdit();
    if (shift) setSelBoth({ ...selRef.current, r2: r, c2: c });
    else setSelBoth({ r, c, r2: r, c2: c });
    requestAnimationFrame(() => gridRef.current?.focus());
  }, [commitEdit, setSelBoth]);
  const onCellEnter = useCallback((r: number, c: number, buttons: number) => {
    if (buttons === 1 && !editingRef.current) setSelBoth({ ...selRef.current, r2: r, c2: c });
  }, [setSelBoth]);
  const onCellDbl = useCallback((r: number, c: number) => startEdit(r, c), [startEdit]);
  const onRowNum = useCallback((r: number) => setSelBoth({ r, c: 0, r2: r, c2: colCountRef.current - 1 }), [setSelBoth]);
  const onRowResize = useCallback((r: number, clientY: number, base: number) => { dragRef.current = { kind: "row", idx: r, start: clientY, base }; }, []);
  const onEditBlur = useCallback(() => commitEdit(), [commitEdit]);

  const clampR = (r: number) => Math.min(Math.max(r, 0), rowCountRef.current - 1);
  const clampC = (c: number) => Math.min(Math.max(c, 0), colCountRef.current - 1);
  const move = (dr: number, dc: number, extend = false) => {
    const s = selRef.current;
    const r = clampR((extend ? s.r : s.r) + (extend ? 0 : dr));
    const c = clampC((extend ? s.c : s.c) + (extend ? 0 : dc));
    if (extend) setSelBoth({ ...s, r2: clampR(s.r2 + dr), c2: clampC(s.c2 + dc) });
    else setSelBoth({ r, c, r2: r, c2: c });
  };

  // Clear the selected range.
  const clearRange = () => {
    const { r1, c1, r2, c2 } = norm(selRef.current);
    const changes: Record<string, Cell | null> = {};
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (cellsRef.current[key(r, c)]) changes[key(r, c)] = null;
    if (Object.keys(changes).length) applyCells(changes);
  };

  // Apply a format change across the selection.
  const applyFormat = (mut: (f: Fmt) => Fmt | undefined) => {
    const { r1, c1, r2, c2 } = norm(selRef.current);
    const changes: Record<string, Cell | null> = {};
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const cur = cellsRef.current[key(r, c)];
      const nf = mut({ ...(cur?.f || {}) });
      const v = cur?.v ?? "";
      if (!nf || Object.keys(nf).length === 0) changes[key(r, c)] = v === "" ? null : { v };
      else changes[key(r, c)] = { v, f: nf };
    }
    applyCells(changes);
  };
  const toggle = (k: "b" | "i" | "u" | "bd" | "w") => applyFormat((f) => { if (f[k]) delete f[k]; else f[k] = 1; return f; });
  const setAlign = (a: "left" | "center" | "right") => applyFormat((f) => { f.a = a; return f; });
  const setColor = (which: "bg" | "fg", v: string) => applyFormat((f) => { if (v) f[which] = v; else delete f[which]; return f; });
  const setSize = (n: number) => applyFormat((f) => { if (n === 14) delete f.sz; else f.sz = n; return f; });

  // ── Format Painter ── copy one cell's formatting onto other cells (Excel's
  // paintbrush). Arm from the active cell's format; the next click/drag on the
  // grid paints that format onto the target cell(s) — values untouched. Single
  // click = one-shot; double-click the button = sticky (paint many until Esc or
  // clicking the button again). Painting REPLACES the target's format, like Excel.
  // Mirror ref + state together (same pattern as setCellsBoth), so the mouseup
  // handler can read the armed format synchronously while the toolbar/cursor
  // re-render off the state.
  const setPainter = useCallback((p: { f: Fmt; sticky: boolean } | null) => { painterRef.current = p; setPainterOn(p !== null); }, []);
  const disarmPainter = useCallback(() => setPainter(null), [setPainter]);
  const armPainter = (sticky: boolean) => {
    const src = cellsRef.current[key(selRef.current.r, selRef.current.c)]?.f;
    setPainter({ f: { ...(src || {}) }, sticky });
  };
  const togglePainter = () => { if (painterRef.current) disarmPainter(); else armPainter(false); };
  const paintSelection = useCallback(() => {
    const p = painterRef.current;
    if (!p) return;
    const { r1, c1, r2, c2 } = norm(selRef.current);
    const hasFmt = Object.keys(p.f).length > 0;
    const changes: Record<string, Cell | null> = {};
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const v = cellsRef.current[key(r, c)]?.v ?? "";
      changes[key(r, c)] = hasFmt ? { v, f: { ...p.f } } : v === "" ? null : { v };
    }
    if (Object.keys(changes).length) applyCells(changes);
  }, [applyCells]);

  // ── Clipboard ──
  const copyRange = useCallback(async () => {
    const { r1, c1, r2, c2 } = norm(selRef.current);
    try { await navigator.clipboard.writeText(toTSV(cellsRef.current, r1, c1, r2, c2)); } catch { /* clipboard blocked */ }
  }, []);
  const pasteText = useCallback((text: string) => {
    const grid = parseGrid(text, "\t");
    const s = selRef.current;
    const startR = Math.min(s.r, s.r2), startC = Math.min(s.c, s.c2);
    const changes: Record<string, Cell | null> = {};
    let maxR = startR, maxC = startC;
    grid.forEach((row, i) => row.forEach((val, j) => {
      const r = clampR(startR + i), c = clampC(startC + j);
      maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
      const cur = cellsRef.current[key(r, c)];
      changes[key(r, c)] = val === "" ? (cur?.f ? { v: "", f: cur.f } : null) : { v: val, ...(cur?.f ? { f: cur.f } : {}) };
    }));
    if (Object.keys(changes).length) { applyCells(changes); setSelBoth({ r: startR, c: startC, r2: maxR, c2: maxC }); }
  }, [applyCells]);

  // ── Row / column insert & delete (remap the sparse cell keys) ──
  // A structural op rewrites the cell map + dimension maps. We queue a proper
  // DELTA (shifted-away keys → null, new keys → value) so the server merge
  // deletes stale keys instead of leaving duplicates. Cleared undo (structural
  // ops aren't undoable in v1) keeps undo consistent.
  const commitStructural = (nc: Cells, nrh: Dims, ncw: Dims) => {
    for (const k of Object.keys(cellsRef.current)) if (!(k in nc)) pCells.current[k] = null;
    for (const k of Object.keys(nc)) pCells.current[k] = nc[k];
    for (const k of Object.keys(rowHRef.current)) if (!(k in nrh)) pRowH.current[k] = null;
    for (const k of Object.keys(nrh)) pRowH.current[k] = nrh[k];
    for (const k of Object.keys(colWRef.current)) if (!(k in ncw)) pColW.current[k] = null;
    for (const k of Object.keys(ncw)) pColW.current[k] = ncw[k];
    setCellsBoth(nc);
    rowHRef.current = nrh; setRowHeights(nrh);
    colWRef.current = ncw; setColWidths(ncw);
    undoStack.current = []; redoStack.current = [];
    scheduleSave();
  };
  const insertRow = (at: number) => {
    const nc: Cells = {};
    for (const [k, val] of Object.entries(cellsRef.current)) { const [r, c] = k.split(":").map(Number); nc[key(r >= at ? r + 1 : r, c)] = val; }
    const nrh: Dims = {}; for (const [ks, v] of Object.entries(rowHRef.current)) { const idx = Number(ks); nrh[idx >= at ? idx + 1 : idx] = v; }
    rowCountRef.current = Math.min(rowCountRef.current + 1, 5000); setRowCount(rowCountRef.current); pCounts.current.rowCount = rowCountRef.current;
    commitStructural(nc, nrh, colWRef.current);
  };
  const deleteRow = (at: number) => {
    const nc: Cells = {};
    for (const [k, val] of Object.entries(cellsRef.current)) { const [r, c] = k.split(":").map(Number); if (r === at) continue; nc[key(r > at ? r - 1 : r, c)] = val; }
    const nrh: Dims = {}; for (const [ks, v] of Object.entries(rowHRef.current)) { const idx = Number(ks); if (idx === at) continue; nrh[idx > at ? idx - 1 : idx] = v; }
    commitStructural(nc, nrh, colWRef.current);
  };
  const insertCol = (at: number) => {
    const nc: Cells = {};
    for (const [k, val] of Object.entries(cellsRef.current)) { const [r, c] = k.split(":").map(Number); nc[key(r, c >= at ? c + 1 : c)] = val; }
    const ncw: Dims = {}; for (const [ks, v] of Object.entries(colWRef.current)) { const idx = Number(ks); ncw[idx >= at ? idx + 1 : idx] = v; }
    colCountRef.current = Math.min(colCountRef.current + 1, 200); setColCount(colCountRef.current); pCounts.current.colCount = colCountRef.current;
    commitStructural(nc, rowHRef.current, ncw);
  };
  const deleteCol = (at: number) => {
    const nc: Cells = {};
    for (const [k, val] of Object.entries(cellsRef.current)) { const [r, c] = k.split(":").map(Number); if (c === at) continue; nc[key(r, c > at ? c - 1 : c)] = val; }
    const ncw: Dims = {}; for (const [ks, v] of Object.entries(colWRef.current)) { const idx = Number(ks); if (idx === at) continue; ncw[idx > at ? idx - 1 : idx] = v; }
    commitStructural(nc, rowHRef.current, ncw);
  };

  // ── Resizing (drag row/col borders) ──
  const dragRef = useRef<{ kind: "row" | "col"; idx: number; start: number; base: number } | null>(null);
  // Format Painter: the copied source format + whether it stays armed (sticky).
  const painterRef = useRef<{ f: Fmt; sticky: boolean } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      if (d.kind === "col") { const w = Math.min(Math.max(d.base + (e.clientX - d.start), 24), 800); const nw = { ...colWRef.current, [d.idx]: Math.round(w) }; colWRef.current = nw; setColWidths(nw); }
      else { const h = Math.min(Math.max(d.base + (e.clientY - d.start), 16), 400); const nh = { ...rowHRef.current, [d.idx]: Math.round(h) }; rowHRef.current = nh; setRowHeights(nh); }
    };
    const onUp = () => {
      const d = dragRef.current; if (!d) return; dragRef.current = null;
      if (d.kind === "col") pColW.current[d.idx] = colWRef.current[d.idx]; else pRowH.current[d.idx] = rowHRef.current[d.idx];
      scheduleSave();
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Format Painter application: while armed, a mouseup that lands on a real data
  // cell paints the copied format onto the just-selected range. Guarded to cells
  // so header/resize-handle releases (and the arming button click, whose target
  // is the toolbar) never paint.
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      if (!painterRef.current) return;
      const t = e.target;
      if (!(t instanceof Element) || !t.closest('td[id^="cell-"]')) return;
      paintSelection();
      if (!painterRef.current?.sticky) disarmPainter();
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [paintSelection, disarmPainter]);

  // Esc cancels an armed painter (bound only while armed).
  useEffect(() => {
    if (!painterOn) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") disarmPainter(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [painterOn, disarmPainter]);

  // ── Keyboard (grid focused, not editing) ──
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (editingRef.current) return; // the input handles its own keys
    const s = selRef.current;
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "c") { e.preventDefault(); copyRange(); return; }
    if (meta && e.key.toLowerCase() === "x") { e.preventDefault(); copyRange().then(clearRange); return; }
    if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
    if (meta && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); return; }
    if (meta && e.key.toLowerCase() === "a") { e.preventDefault(); setSelBoth({ r: 0, c: 0, r2: rowCountRef.current - 1, c2: colCountRef.current - 1 }); return; }
    if (meta && e.key.toLowerCase() === "f") { e.preventDefault(); setFindOpen(true); return; }
    if (meta && e.key.toLowerCase() === "b") { e.preventDefault(); toggle("b"); return; }
    if (meta && e.key.toLowerCase() === "i") { e.preventDefault(); toggle("i"); return; }
    if (meta && e.key.toLowerCase() === "u") { e.preventDefault(); toggle("u"); return; }
    if (meta) return;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); move(-1, 0, e.shiftKey); return;
      case "ArrowDown": e.preventDefault(); move(1, 0, e.shiftKey); return;
      case "ArrowLeft": e.preventDefault(); move(0, -1, e.shiftKey); return;
      case "ArrowRight": e.preventDefault(); move(0, 1, e.shiftKey); return;
      case "Tab": e.preventDefault(); { const c = clampC(s.c + (e.shiftKey ? -1 : 1)); setSelBoth({ r: s.r, c, r2: s.r, c2: c }); } return;
      case "Enter": e.preventDefault(); startEdit(s.r, s.c); return;
      case "F2": e.preventDefault(); startEdit(s.r, s.c); return;
      case "Backspace": case "Delete": e.preventDefault(); clearRange(); return;
      case "Escape": setSelBoth({ r: s.r, c: s.c, r2: s.r, c2: s.c }); return;
      default:
        if (e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(s.r, s.c, e.key); }
    }
  };
  const onEditKeyDown = (e: React.KeyboardEvent) => {
    const ed = editingRef.current; if (!ed) return;
    if (e.key === "Enter") { e.preventDefault(); commitEdit({ r: clampR(ed.r + 1), c: ed.c }); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit({ r: ed.r, c: clampC(ed.c + (e.shiftKey ? -1 : 1)) }); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  };

  // ── Sheet tabs ──
  const switchSheet = async (id: string) => {
    if (id === activeIdRef.current) return;
    await flush();
    activeIdRef.current = id; setActiveId(id);
    await loadSheet(id);
    requestAnimationFrame(() => gridRef.current?.focus());
  };
  const addSheet = async () => {
    await flush();
    const res = await fetch("/api/my-excel/sheets", { method: "POST" });
    if (!res.ok) return flash((await res.json().catch(() => ({}))).error || "Could not add a sheet.");
    const { sheet } = await res.json();
    setSheets((p) => [...p, sheet]);
    await switchSheet(sheet.id);
  };
  const deleteSheet = async (id: string) => {
    const t = sheets.find((x) => x.id === id);
    if (!confirm(`Delete "${t?.name || "this sheet"}"? Its contents are permanently removed.`)) return;
    const res = await fetch(`/api/my-excel/sheets/${id}`, { method: "DELETE" });
    if (!res.ok) return flash((await res.json().catch(() => ({}))).error || "Could not delete the sheet.");
    const { nextId } = await res.json();
    setSheets((p) => p.filter((x) => x.id !== id));
    if (activeIdRef.current === id && nextId) { activeIdRef.current = nextId; setActiveId(nextId); await loadSheet(nextId); }
  };
  const commitRename = async (id: string, name: string) => {
    setRenaming(null);
    const clean = name.trim().slice(0, 120);
    if (!clean) return;
    setSheets((p) => p.map((s) => (s.id === id ? { ...s, name: clean } : s)));
    await fetch(`/api/my-excel/sheets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean }) });
  };

  // ── CSV import / export ──
  const importCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const grid = parseGrid(String(reader.result || ""), ",");
      const changes: Record<string, Cell | null> = {};
      let needRows = rowCountRef.current, needCols = colCountRef.current;
      grid.forEach((row, r) => { needRows = Math.max(needRows, r + 1); row.forEach((v, c) => { needCols = Math.max(needCols, c + 1); if (v !== "") changes[key(r, c)] = { v }; }); });
      if (needRows > rowCountRef.current) { rowCountRef.current = Math.min(needRows, 5000); setRowCount(rowCountRef.current); pCounts.current.rowCount = rowCountRef.current; }
      if (needCols > colCountRef.current) { colCountRef.current = Math.min(needCols, 200); setColCount(colCountRef.current); pCounts.current.colCount = colCountRef.current; }
      applyCells(changes);
      flash(`Imported ${grid.length} rows.`);
    };
    reader.readAsText(file);
  };

  // ── Find ──
  const matches = useMemo(() => {
    if (!findOpen || !findQ) return [] as string[];
    const q = findQ.toLowerCase();
    return Object.entries(cells).filter(([, v]) => v.v.toLowerCase().includes(q)).map(([k]) => k);
  }, [findOpen, findQ, cells]);
  const [matchIdx, setMatchIdx] = useState(0);
  const gotoMatch = (i: number) => {
    if (matches.length === 0) return;
    const p = ((i % matches.length) + matches.length) % matches.length;
    setMatchIdx(p);
    const [r, c] = matches[p].split(":").map(Number);
    setSelBoth({ r, c, r2: r, c2: c });
    requestAnimationFrame(() => document.getElementById(`cell-${r}-${c}`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };

  // Per-row cell slices with STABLE refs — rebuilt only when `cells` changes,
  // and a row's ref is reused when its cells are unchanged, so an edit
  // re-renders only the one changed row (not the whole grid).
  const rowMap = useMemo(() => {
    const byRow: Record<number, Record<number, Cell>> = {};
    for (const k in cells) {
      const i = k.indexOf(":");
      (byRow[+k.slice(0, i)] ||= {})[+k.slice(i + 1)] = cells[k];
    }
    return byRow;
  }, [cells]);

  // ── Render ──
  const sname = sheets.find((s) => s.id === activeId)?.name || "";
  const curF = cells[key(sel.r, sel.c)]?.f || {};
  const nsel = norm(sel);

  if (fatal) return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><div className="text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-5 py-4 max-w-md text-center">{fatal}</div></div>;

  const chip =
    status === "saved" ? { t: "Saved ✓", c: "text-emerald-700 bg-emerald-50 border-emerald-200" }
    : status === "saving" ? { t: "Saving…", c: "text-slate-600 bg-slate-100 border-slate-200" }
    : status === "dirty" ? { t: "Unsaved…", c: "text-slate-600 bg-slate-100 border-slate-200" }
    : status === "offline" ? { t: "Offline", c: "text-amber-800 bg-amber-50 border-amber-200" }
    : status === "loading" ? { t: "Loading…", c: "text-slate-500 bg-slate-100 border-slate-200" }
    : { t: "Save failed — retrying", c: "text-red-700 bg-red-50 border-red-200" };

  const tbBtn = "h-7 min-w-7 px-1.5 inline-flex items-center justify-center rounded text-[13px] text-slate-700 hover:bg-slate-200 border border-transparent";
  const tbOn = "bg-slate-300 border-slate-400";

  return (
    <div className="h-screen flex flex-col bg-white select-none text-slate-900">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-emerald-600 text-white text-xs font-bold shrink-0">X</span>
        <span className="text-sm font-semibold text-slate-800">My Excel</span>
        <span className={`text-[11px] font-medium border rounded-full px-2.5 py-0.5 ${chip.c}`}>{chip.t}</span>
        {notice && <span className="text-[11px] font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 truncate">{notice}</span>}
        <span className="ml-auto text-[11px] text-slate-400 hidden md:block truncate max-w-[40%]">{sname}</span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-slate-200 bg-white shrink-0 text-slate-700">
        <button className={`${tbBtn} font-bold ${curF.b ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("b")} title="Bold (Ctrl+B)">B</button>
        <button className={`${tbBtn} italic ${curF.i ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("i")} title="Italic (Ctrl+I)">I</button>
        <button className={`${tbBtn} underline ${curF.u ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("u")} title="Underline (Ctrl+U)">U</button>
        <div className="w-px h-5 bg-slate-200 mx-0.5" />
        <button className={`${tbBtn} ${curF.a === "left" || !curF.a ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setAlign("left")} title="Align left">⬅</button>
        <button className={`${tbBtn} ${curF.a === "center" ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setAlign("center")} title="Align center">⬌</button>
        <button className={`${tbBtn} ${curF.a === "right" ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setAlign("right")} title="Align right">➡</button>
        <div className="w-px h-5 bg-slate-200 mx-0.5" />
        <label className={tbBtn} title="Text color" onMouseDown={(e) => e.preventDefault()}>A<input type="color" className="w-0 h-0 opacity-0" onChange={(e) => setColor("fg", e.target.value)} /></label>
        <label className={tbBtn} title="Fill color" onMouseDown={(e) => e.preventDefault()}>▦<input type="color" className="w-0 h-0 opacity-0" onChange={(e) => setColor("bg", e.target.value)} /></label>
        <button className={tbBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => { setColor("fg", ""); setColor("bg", ""); }} title="Clear colors">⌫</button>
        <button className={`${tbBtn} ${curF.bd ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("bd")} title="Border">▣</button>
        <button className={`${tbBtn} ${curF.w ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle("w")} title="Wrap text">⤶ Wrap</button>
        <button className={`${tbBtn} ${painterOn ? tbOn : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={togglePainter} onDoubleClick={() => armPainter(true)} title="Format Painter — copy this cell's formatting, then click a cell to apply it (double-click to keep painting; Esc to cancel)">🖌</button>
        <select className="h-7 text-[13px] border border-slate-200 rounded px-1" value={curF.sz || 14} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => setSize(Number(e.target.value))} title="Font size">
          {[10, 11, 12, 14, 16, 18, 20, 24].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="w-px h-5 bg-slate-200 mx-0.5" />
        <button className={tbBtn} onClick={() => insertRow(nsel.r1)} title="Insert row above">+Row</button>
        <button className={tbBtn} onClick={() => deleteRow(nsel.r1)} title="Delete row">−Row</button>
        <button className={tbBtn} onClick={() => insertCol(nsel.c1)} title="Insert column left">+Col</button>
        <button className={tbBtn} onClick={() => deleteCol(nsel.c1)} title="Delete column">−Col</button>
        <div className="w-px h-5 bg-slate-200 mx-0.5" />
        <button className={tbBtn} onClick={() => fileRef.current?.click()} title="Import CSV">Import</button>
        <button className={tbBtn} onClick={() => setFindOpen(true)} title="Find (Ctrl+F)">Find</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.currentTarget.value = ""; }} />
      </div>

      {findOpen && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-slate-200 bg-white shrink-0">
          <input autoFocus value={findQ} onChange={(e) => { setFindQ(e.target.value); setMatchIdx(0); }} onKeyDown={(e) => { if (e.key === "Enter") gotoMatch(matchIdx + (e.shiftKey ? -1 : 1)); if (e.key === "Escape") { setFindOpen(false); gridRef.current?.focus(); } }} placeholder="Find in sheet…" className="w-56 rounded-md border border-slate-200 px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <span className="text-xs text-slate-500 tabular-nums">{matches.length ? `${matchIdx % matches.length + 1} / ${matches.length}` : findQ ? "0" : ""}</span>
          <button className="w-7 h-7 inline-flex items-center justify-center rounded border border-slate-300 text-slate-800 font-bold hover:bg-slate-100" onClick={() => gotoMatch(matchIdx - 1)}>↑</button>
          <button className="w-7 h-7 inline-flex items-center justify-center rounded border border-slate-300 text-slate-800 font-bold hover:bg-slate-100" onClick={() => gotoMatch(matchIdx + 1)}>↓</button>
          <button className="text-slate-400 hover:text-slate-600 px-1" onClick={() => { setFindOpen(false); gridRef.current?.focus(); }}>✕</button>
        </div>
      )}

      {/* Grid */}
      <div ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown} onPaste={(e) => { e.preventDefault(); pasteText(e.clipboardData.getData("text")); }} className={`flex-1 overflow-auto outline-none [scrollbar-gutter:stable]${painterOn ? " cursor-copy" : ""}`}>
        <table className="border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: ROWNUM_W }} />
            {Array.from({ length: colCount }, (_, c) => <col key={c} style={{ width: colWidths[c] || DEF_COL_W }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-slate-100 border border-slate-300" style={{ height: HEADER_H, width: ROWNUM_W }} onClick={() => setSelBoth({ r: 0, c: 0, r2: rowCount - 1, c2: colCount - 1 })} />
              {Array.from({ length: colCount }, (_, c) => (
                <th key={c} className={`sticky top-0 z-20 border border-slate-300 text-[11px] font-medium text-slate-600 relative ${c >= nsel.c1 && c <= nsel.c2 ? "bg-emerald-100" : "bg-slate-100"}`} style={{ height: HEADER_H }} onClick={() => setSelBoth({ r: 0, c, r2: rowCount - 1, c2: c })}>
                  {colLabel(c)}
                  <span className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); dragRef.current = { kind: "col", idx: c, start: e.clientX, base: colWidths[c] || DEF_COL_W }; }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, r) => {
              const rowSel = r >= nsel.r1 && r <= nsel.r2;
              return (
                <GridRow
                  key={r}
                  r={r}
                  colCount={colCount}
                  height={rowHeights[r] || DEF_ROW_H}
                  rowCells={rowMap[r] || EMPTY_ROW}
                  rowSelected={rowSel}
                  selLeft={rowSel ? nsel.c1 : -1}
                  selRight={rowSel ? nsel.c2 : -1}
                  activeCol={sel.r === r ? sel.c : -1}
                  editingCol={editing?.r === r ? editing.c : -1}
                  editSeed={editing?.r === r ? editing.seed : ""}
                  editInputRef={editInputRef}
                  onDown={onCellDown}
                  onEnter={onCellEnter}
                  onDbl={onCellDbl}
                  onRowNum={onRowNum}
                  onRowResize={onRowResize}
                  onEditKeyDown={onEditKeyDown}
                  onEditBlur={onEditBlur}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sheet tabs */}
      <div className="flex items-center gap-1 px-2 py-1 border-t border-slate-200 bg-slate-50 shrink-0 overflow-x-auto">
        {sheets.map((s) => (
          <div key={s.id} className={`group flex items-center gap-1 rounded-t px-2.5 py-1 text-[13px] border-b-2 cursor-pointer whitespace-nowrap ${s.id === activeId ? "bg-white border-emerald-600 text-emerald-700 font-medium" : "border-transparent text-slate-600 hover:bg-slate-100"}`} onClick={() => switchSheet(s.id)} onDoubleClick={() => { setRenaming(s.id); }}>
            {renaming === s.id ? (
              <input autoFocus defaultValue={s.name} onBlur={(e) => commitRename(s.id, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(s.id, (e.target as HTMLInputElement).value); if (e.key === "Escape") setRenaming(null); }} className="w-24 text-[13px] border border-emerald-400 rounded px-1 outline-none" onClick={(e) => e.stopPropagation()} />
            ) : (
              <>
                <span>{s.name}</span>
                {sheets.length > 1 && <button className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 text-xs" onClick={(e) => { e.stopPropagation(); deleteSheet(s.id); }} title="Delete sheet">✕</button>}
              </>
            )}
          </div>
        ))}
        <button className="ml-1 w-6 h-6 inline-flex items-center justify-center rounded text-slate-500 hover:bg-slate-200 text-base" onClick={addSheet} title="New sheet">+</button>
        <span className="ml-auto text-[11px] text-slate-400 pr-2 hidden sm:block">{colLabel(sel.c)}{sel.r + 1}</span>
      </div>
    </div>
  );
}
