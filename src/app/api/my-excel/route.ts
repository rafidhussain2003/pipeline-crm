import { NextResponse } from "next/server";
import { requireExcel, getOrCreateWorkbook, listSheets } from "@/lib/excel/access";

// My Excel — the caller's workbook + its sheet list (metadata only; each
// sheet's cells load on demand so opening the workbook is fast). The workbook
// is created (with a first "Sheet1") on first access. Strictly the caller's
// own workbook — companyId + userId come from the session, never the request.
export async function GET() {
  const auth = await requireExcel();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  await getOrCreateWorkbook(session);
  const sheets = await listSheets(session);
  return NextResponse.json({ sheets }, { headers: { "Cache-Control": "no-store" } });
}
