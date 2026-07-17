import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { attendanceAssignments, attendanceRecords, attendanceShifts, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { assignShift, dateInTz, ensureAttendanceSetup, shiftTimezone } from "@/lib/attendance";

// The attendance roster: every active member with their shift + today's state.
export async function GET() {
  const auth = await requireAttendance("attendance:view");
  if (!auth.ok) return auth.response;
  const companyId = auth.session.companyId;
  await ensureAttendanceSetup(companyId);
  const tz = await shiftTimezone(companyId, null);
  const today = dateInTz(new Date(), tz);

  const roster = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      shiftId: attendanceAssignments.shiftId,
      shiftName: attendanceShifts.name,
      checkInAt: attendanceRecords.checkInAt,
      checkOutAt: attendanceRecords.checkOutAt,
      lateStatus: attendanceRecords.lateStatus,
      workedMinutes: attendanceRecords.workedMinutes,
    })
    .from(users)
    .leftJoin(attendanceAssignments, and(eq(attendanceAssignments.userId, users.id), eq(attendanceAssignments.companyId, companyId)))
    .leftJoin(attendanceShifts, eq(attendanceShifts.id, attendanceAssignments.shiftId))
    .leftJoin(attendanceRecords, and(eq(attendanceRecords.userId, users.id), eq(attendanceRecords.companyId, companyId), eq(attendanceRecords.workDate, today)))
    .where(and(eq(users.companyId, companyId), eq(users.active, true), isNull(users.deletedAt)));

  return NextResponse.json({ employees: roster, workDate: today });
}

// Assign a shift: { userId, shiftId | null }
export async function PUT(req: NextRequest) {
  const auth = await requireAttendance("attendance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (!body?.userId || typeof body.userId !== "string") return NextResponse.json({ error: "userId is required" }, { status: 400 });
  // The target must belong to this company.
  const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, body.userId), eq(users.companyId, auth.session.companyId))).limit(1);
  if (!target) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  try {
    const assignment = await assignShift(auth.session.companyId, auth.session.userId, body.userId, body.shiftId || null);
    return NextResponse.json({ assignment });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
