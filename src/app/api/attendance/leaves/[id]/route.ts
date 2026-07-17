import { NextRequest, NextResponse } from "next/server";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { cancelLeave, decideLeave, hasAttendancePermission } from "@/lib/attendance";

// { action: "approve" | "reject" | "cancel", note? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  try {
    if (action === "approve" || action === "reject") {
      const auth = await requireAttendance("attendance:manage");
      if (!auth.ok) return auth.response;
      const leave = await decideLeave(auth.session.companyId, auth.session.userId, id, action === "approve" ? "approved" : "rejected", typeof body?.note === "string" ? body.note : undefined);
      return NextResponse.json({ leave });
    }
    if (action === "cancel") {
      const auth = await requireAttendance("attendance:self");
      if (!auth.ok) return auth.response;
      const leave = await cancelLeave(auth.session.companyId, auth.session.userId, id, hasAttendancePermission(auth.session.role, "attendance:manage"));
      return NextResponse.json({ leave });
    }
    return NextResponse.json({ error: "action must be approve, reject or cancel" }, { status: 400 });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
