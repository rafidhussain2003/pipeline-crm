import { NextRequest, NextResponse } from "next/server";
import { requireAttendance } from "@/lib/attendance/guard";
import { listRecords } from "@/lib/attendance";

// Attendance day records (managers see everyone; employees see their own via
// ?self=1, enforced server-side by overriding the userId filter).
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const selfOnly = p.get("self") === "1";
  const auth = await requireAttendance(selfOnly ? "attendance:self" : "attendance:view");
  if (!auth.ok) return auth.response;
  const records = await listRecords(auth.session.companyId, {
    userId: selfOnly ? auth.session.userId : p.get("userId") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    limit: Number(p.get("limit")) || 50,
    offset: Number(p.get("offset")) || 0,
  });
  return NextResponse.json({ records });
}
