import { NextRequest, NextResponse } from "next/server";
import { requireAttendance } from "@/lib/attendance/guard";
import { listAttendanceLogs } from "@/lib/attendance";

// The append-only attendance event stream (managers).
export async function GET(req: NextRequest) {
  const auth = await requireAttendance("attendance:view");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const logs = await listAttendanceLogs(auth.session.companyId, {
    userId: p.get("userId") || undefined,
    action: p.get("action") || undefined,
    limit: Number(p.get("limit")) || 50,
    offset: Number(p.get("offset")) || 0,
  });
  return NextResponse.json({ logs });
}
