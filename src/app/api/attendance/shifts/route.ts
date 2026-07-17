import { NextRequest, NextResponse } from "next/server";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { createShift, ensureAttendanceSetup, listShifts } from "@/lib/attendance";

export async function GET() {
  const auth = await requireAttendance("attendance:view");
  if (!auth.ok) return auth.response;
  await ensureAttendanceSetup(auth.session.companyId);
  return NextResponse.json({ shifts: await listShifts(auth.session.companyId) });
}

export async function POST(req: NextRequest) {
  const auth = await requireAttendance("attendance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const shift = await createShift(auth.session.companyId, auth.session.userId, {
      name: String(body?.name ?? ""),
      startMinute: Number(body?.startMinute),
      endMinute: Number(body?.endMinute),
      graceMinutes: body?.graceMinutes !== undefined ? Number(body.graceMinutes) : undefined,
      veryLateMinutes: body?.veryLateMinutes !== undefined ? Number(body.veryLateMinutes) : undefined,
      earlyLeaveMinutes: body?.earlyLeaveMinutes !== undefined ? Number(body.earlyLeaveMinutes) : undefined,
      flexible: !!body?.flexible,
      timezone: typeof body?.timezone === "string" && body.timezone ? body.timezone : null,
    });
    return NextResponse.json({ shift }, { status: 201 });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
