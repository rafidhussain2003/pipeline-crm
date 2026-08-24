import { NextResponse } from "next/server";
import { db } from "@/db";
import { excelSheets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireExcel, getOrCreateWorkbook, LIMITS } from "@/lib/excel/access";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";

// Create a new sheet in the caller's workbook. Named "Sheet N" and appended at
// the end. Audited (structural event only — never cell contents).
export async function POST() {
  const auth = await requireExcel();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const workbookId = await getOrCreateWorkbook(session);
  const existing = await db
    .select({ position: excelSheets.position, name: excelSheets.name })
    .from(excelSheets)
    .where(and(eq(excelSheets.companyId, session.companyId), eq(excelSheets.userId, session.userId)));
  if (existing.length >= LIMITS.MAX_SHEETS) {
    return NextResponse.json({ error: `A workbook can have at most ${LIMITS.MAX_SHEETS} sheets.` }, { status: 400 });
  }
  const nextPos = existing.reduce((m, s) => Math.max(m, s.position), -1) + 1;
  // First free "Sheet N" name.
  let n = existing.length + 1;
  const names = new Set(existing.map((s) => s.name));
  while (names.has(`Sheet${n}`)) n++;

  const [sheet] = await db
    .insert(excelSheets)
    .values({ workbookId, companyId: session.companyId, userId: session.userId, name: `Sheet${n}`, position: nextPos })
    .returning({ id: excelSheets.id, name: excelSheets.name, position: excelSheets.position });

  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "excel.sheet_created", entityType: "excel_sheet", entityId: sheet.id });
  return NextResponse.json({ sheet }, { status: 201 });
}
