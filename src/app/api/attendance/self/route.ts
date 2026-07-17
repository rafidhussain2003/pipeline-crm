import { NextRequest, NextResponse } from "next/server";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { checkIn, checkOut, startBreak, endBreak, todayStatus } from "@/lib/attendance";

// The employee's own attendance: current status + the four self actions.
export async function GET() {
  const auth = await requireAttendance("attendance:self");
  if (!auth.ok) return auth.response;
  const status = await todayStatus(auth.session.companyId, auth.session.userId);
  return NextResponse.json(status);
}

// { action: "check_in" | "check_out" | "break_start" | "break_end" }
export async function POST(req: NextRequest) {
  const auth = await requireAttendance("attendance:self");
  if (!auth.ok) return auth.response;
  const { companyId, userId } = auth.session;
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "check_in") {
      const record = await checkIn(companyId, userId, {
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent"),
        timezone: typeof body?.timezone === "string" ? body.timezone : null,
      });
      return NextResponse.json({ record }, { status: 201 });
    }
    if (body?.action === "check_out") return NextResponse.json({ record: await checkOut(companyId, userId) });
    if (body?.action === "break_start") return NextResponse.json({ break: await startBreak(companyId, userId) }, { status: 201 });
    if (body?.action === "break_end") return NextResponse.json({ record: await endBreak(companyId, userId) });
    return NextResponse.json({ error: "action must be check_in, check_out, break_start or break_end" }, { status: 400 });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
