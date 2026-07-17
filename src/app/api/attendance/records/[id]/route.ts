import { NextRequest, NextResponse } from "next/server";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { manualAdjust } from "@/lib/attendance";

// Manual adjustment — reason REQUIRED; before/after recorded to the attendance
// log and the platform audit log inside the service.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAttendance("attendance:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const record = await manualAdjust(
      auth.session.companyId,
      auth.session.userId,
      id,
      {
        checkInAt: typeof body?.checkInAt === "string" ? body.checkInAt : undefined,
        checkOutAt: body?.checkOutAt !== undefined ? body.checkOutAt : undefined,
        lateStatus: typeof body?.lateStatus === "string" ? body.lateStatus : undefined,
        departureStatus: typeof body?.departureStatus === "string" ? body.departureStatus : undefined,
        notes: body?.notes !== undefined ? body.notes : undefined,
      },
      String(body?.reason ?? ""),
    );
    return NextResponse.json({ record });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
