import { NextRequest, NextResponse } from "next/server";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { deleteHoliday } from "@/lib/attendance";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAttendance("attendance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteHoliday(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
