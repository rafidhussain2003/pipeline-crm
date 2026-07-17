import { NextRequest, NextResponse } from "next/server";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { deleteShift, updateShift } from "@/lib/attendance";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAttendance("attendance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const shift = await updateShift(auth.session.companyId, auth.session.userId, id, {
      name: typeof body?.name === "string" ? body.name : undefined,
      startMinute: body?.startMinute !== undefined ? Number(body.startMinute) : undefined,
      endMinute: body?.endMinute !== undefined ? Number(body.endMinute) : undefined,
      graceMinutes: body?.graceMinutes !== undefined ? Number(body.graceMinutes) : undefined,
      veryLateMinutes: body?.veryLateMinutes !== undefined ? Number(body.veryLateMinutes) : undefined,
      earlyLeaveMinutes: body?.earlyLeaveMinutes !== undefined ? Number(body.earlyLeaveMinutes) : undefined,
      flexible: typeof body?.flexible === "boolean" ? body.flexible : undefined,
      timezone: body?.timezone !== undefined ? (body.timezone || null) : undefined,
      active: typeof body?.active === "boolean" ? body.active : undefined,
    });
    return NextResponse.json({ shift });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAttendance("attendance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteShift(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
