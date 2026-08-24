import { NextResponse } from "next/server";
import { db } from "@/db";
import { excelWorkbooks, excelSheets } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireCompanySession, type CompanySession } from "@/lib/auth";

// My Excel — access + shared server helpers. A personal spreadsheet workspace
// per user, completely separate from the Sales Ledger. EVERY query is scoped by
// companyId + userId from the verified session; ownership is NEVER taken from
// the request (no trusted userId/companyId/workbookId in the body or URL), so
// an agent can only ever reach their own workbook and cross-company access is
// impossible.
//
// The PURE sanitizers + delta merge live in ./sanitize (unit-tested there);
// re-exported so the routes keep importing them from one place.
export { LIMITS, mergeCells, mergeDims, sanitizeFormat } from "./sanitize";

const ALLOWED_ROLES = new Set(["admin", "manager", "agent"]);

type Auth = { ok: true; session: CompanySession } | { ok: false; response: NextResponse };

export async function requireExcel(): Promise<Auth> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (!ALLOWED_ROLES.has(auth.session.role)) {
    return { ok: false, response: NextResponse.json({ error: "You do not have access to My Excel." }, { status: 403 }) };
  }
  return auth;
}

// Get (or create on first use) the caller's single workbook. Idempotent under
// races via the (company,user) unique index.
export async function getOrCreateWorkbook(session: CompanySession): Promise<string> {
  const [existing] = await db
    .select({ id: excelWorkbooks.id })
    .from(excelWorkbooks)
    .where(and(eq(excelWorkbooks.companyId, session.companyId), eq(excelWorkbooks.userId, session.userId)))
    .limit(1);
  if (existing) return existing.id;

  await db.insert(excelWorkbooks).values({ companyId: session.companyId, userId: session.userId }).onConflictDoNothing();
  const [wb] = await db
    .select({ id: excelWorkbooks.id })
    .from(excelWorkbooks)
    .where(and(eq(excelWorkbooks.companyId, session.companyId), eq(excelWorkbooks.userId, session.userId)))
    .limit(1);
  // First sheet seeded once, only if the workbook has none.
  const sheets = await db.select({ id: excelSheets.id }).from(excelSheets).where(eq(excelSheets.workbookId, wb.id)).limit(1);
  if (sheets.length === 0) {
    await db.insert(excelSheets).values({
      workbookId: wb.id,
      companyId: session.companyId,
      userId: session.userId,
      name: "Sheet1",
      position: 0,
    });
  }
  return wb.id;
}

// The sheet list for the caller's workbook (metadata only — cells load on
// demand per sheet, so opening the workbook is fast).
export function listSheets(session: CompanySession) {
  return db
    .select({ id: excelSheets.id, name: excelSheets.name, position: excelSheets.position })
    .from(excelSheets)
    .where(and(eq(excelSheets.companyId, session.companyId), eq(excelSheets.userId, session.userId)))
    .orderBy(asc(excelSheets.position), asc(excelSheets.createdAt));
}

// Owner-scoped fetch of a single sheet: resolves ONLY when the id belongs to
// this caller (company + user). A tampered id from another user/company simply
// returns null → 404. No existence oracle, no IDOR.
export async function loadOwnedSheet(session: CompanySession, id: string) {
  const [row] = await db
    .select()
    .from(excelSheets)
    .where(and(eq(excelSheets.id, id), eq(excelSheets.companyId, session.companyId), eq(excelSheets.userId, session.userId)))
    .limit(1);
  return row || null;
}
