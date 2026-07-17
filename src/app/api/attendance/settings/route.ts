import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { attendanceSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { requireAttendance } from "@/lib/attendance/guard";
import { ensureAttendanceSetup, getShift, ATTENDANCE_REPORTS } from "@/lib/attendance";

export async function GET() {
  const auth = await requireAttendance("attendance:view");
  if (!auth.ok) return auth.response;
  await ensureAttendanceSetup(auth.session.companyId);
  const [settings] = await db.select().from(attendanceSettings).where(eq(attendanceSettings.companyId, auth.session.companyId)).limit(1);
  return NextResponse.json({ settings, reports: ATTENDANCE_REPORTS });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAttendance("attendance:admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};
  if (body?.defaultShiftId !== undefined) {
    if (body.defaultShiftId) {
      const shift = await getShift(auth.session.companyId, body.defaultShiftId);
      if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }
    patch.defaultShiftId = body.defaultShiftId || null;
  }
  if (Array.isArray(body?.weekendDays)) {
    const days = [...new Set(body.weekendDays.filter((d: unknown) => typeof d === "number" && d >= 0 && d <= 6))];
    if (days.length > 6) return NextResponse.json({ error: "At least one working day is required" }, { status: 400 });
    patch.weekendDays = days;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const [settings] = await db
    .update(attendanceSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(attendanceSettings.companyId, auth.session.companyId))
    .returning();
  await recordAudit({ companyId: auth.session.companyId, userId: auth.session.userId, action: "attendance.settings_updated", entityType: "attendance_settings", entityId: auth.session.companyId, after: patch });
  return NextResponse.json({ settings });
}
