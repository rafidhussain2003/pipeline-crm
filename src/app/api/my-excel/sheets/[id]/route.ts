import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { excelSheets } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireExcel, loadOwnedSheet, mergeCells, mergeDims, LIMITS } from "@/lib/excel/access";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { isUuid } from "@/lib/url";

// One sheet. Every handler resolves the sheet ONLY when the id belongs to the
// caller (company + user) — a tampered id from another user/company is a 404.
// Nothing is ever taken from the request for ownership.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireExcel();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sheet = await loadOwnedSheet(auth.session, id);
  if (!sheet) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    {
      sheet: {
        id: sheet.id,
        name: sheet.name,
        cells: sheet.cells,
        rowHeights: sheet.rowHeights,
        colWidths: sheet.colWidths,
        rowCount: sheet.rowCount,
        colCount: sheet.colCount,
        version: sheet.version,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

// Update a sheet: rename/reposition (metadata, no version needed), OR a
// DELTA of cells / row heights / col widths / dimensions (version-guarded
// optimistic concurrency — only changed cells are transmitted, then merged
// server-side into the sheet's sparse jsonb).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireExcel();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const declaredLen = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLen) && declaredLen > 12_000_000) {
    return NextResponse.json({ error: "This change is too large." }, { status: 413 });
  }

  const sheet = await loadOwnedSheet(session, id);
  if (!sheet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const metaSet: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().replace(/[\r\n\t]+/g, " ").slice(0, LIMITS.MAX_NAME_LEN);
    if (name) metaSet.name = name;
  }
  if (Number.isInteger(body.position)) metaSet.position = Math.max(0, body.position as number);

  const hasContent =
    (body.cells && typeof body.cells === "object") ||
    (body.rowHeights && typeof body.rowHeights === "object") ||
    (body.colWidths && typeof body.colWidths === "object") ||
    Number.isInteger(body.rowCount) ||
    Number.isInteger(body.colCount);

  // ── Metadata-only update (rename / reorder) ──
  if (!hasContent) {
    if (Object.keys(metaSet).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    await db
      .update(excelSheets)
      .set({ ...metaSet, updatedAt: new Date() })
      .where(and(eq(excelSheets.id, id), eq(excelSheets.companyId, session.companyId), eq(excelSheets.userId, session.userId)));
    if (metaSet.name) {
      await recordAudit({ companyId: session.companyId, userId: session.userId, action: "excel.sheet_renamed", entityType: "excel_sheet", entityId: id });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Content delta — version-guarded ──
  const version = Number.isInteger(body.version) ? (body.version as number) : null;
  if (version === null) return NextResponse.json({ error: "version is required for content changes." }, { status: 400 });
  if (body.cells && Object.keys(body.cells).length > LIMITS.MAX_CELLS_PER_SAVE) {
    return NextResponse.json({ error: "Too many cells in one change." }, { status: 413 });
  }

  const rowCount = Number.isInteger(body.rowCount) ? clamp(body.rowCount as number, 1, LIMITS.MAX_ROWS) : sheet.rowCount;
  const colCount = Number.isInteger(body.colCount) ? clamp(body.colCount as number, 1, LIMITS.MAX_COLS) : sheet.colCount;

  const set: Record<string, unknown> = { ...metaSet, rowCount, colCount, version: sql`${excelSheets.version} + 1`, updatedAt: new Date() };
  if (body.cells && typeof body.cells === "object") set.cells = mergeCells(sheet.cells, body.cells, rowCount, colCount);
  if (body.rowHeights && typeof body.rowHeights === "object") set.rowHeights = mergeDims(sheet.rowHeights, body.rowHeights, LIMITS.MAX_ROW_H, rowCount);
  if (body.colWidths && typeof body.colWidths === "object") set.colWidths = mergeDims(sheet.colWidths, body.colWidths, LIMITS.MAX_COL_W, colCount);

  const [updated] = await db
    .update(excelSheets)
    .set(set)
    .where(and(eq(excelSheets.id, id), eq(excelSheets.companyId, session.companyId), eq(excelSheets.userId, session.userId), eq(excelSheets.version, version)))
    .returning({ version: excelSheets.version });

  if (!updated) {
    // Another tab saved first — hand back the current copy so the client reconciles.
    const fresh = await loadOwnedSheet(session, id);
    if (!fresh) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(
      {
        error: "This sheet changed in another tab.",
        version: fresh.version,
        cells: fresh.cells,
        rowHeights: fresh.rowHeights,
        colWidths: fresh.colWidths,
        rowCount: fresh.rowCount,
        colCount: fresh.colCount,
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, version: updated.version }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireExcel();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sheet = await loadOwnedSheet(session, id);
  if (!sheet) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Never delete the last sheet — a workbook always has at least one.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(excelSheets)
    .where(and(eq(excelSheets.companyId, session.companyId), eq(excelSheets.userId, session.userId)));
  if (n <= 1) return NextResponse.json({ error: "A workbook must keep at least one sheet." }, { status: 400 });

  await db
    .delete(excelSheets)
    .where(and(eq(excelSheets.id, id), eq(excelSheets.companyId, session.companyId), eq(excelSheets.userId, session.userId)));

  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "excel.sheet_deleted", entityType: "excel_sheet", entityId: id });

  const remaining = await db
    .select({ id: excelSheets.id })
    .from(excelSheets)
    .where(and(eq(excelSheets.companyId, session.companyId), eq(excelSheets.userId, session.userId)))
    .orderBy(asc(excelSheets.position), asc(excelSheets.createdAt))
    .limit(1);
  return NextResponse.json({ ok: true, nextId: remaining[0]?.id ?? null });
}
