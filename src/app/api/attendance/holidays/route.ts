import { NextRequest, NextResponse } from "next/server";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { createHoliday, listHolidays } from "@/lib/attendance";

export async function GET() {
  const auth = await requireAttendance("attendance:self");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ holidays: await listHolidays(auth.session.companyId) });
}

export async function POST(req: NextRequest) {
  const auth = await requireAttendance("attendance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const holiday = await createHoliday(auth.session.companyId, auth.session.userId, {
      name: String(body?.name ?? ""),
      date: String(body?.date ?? ""),
      kind: typeof body?.kind === "string" ? body.kind : undefined,
      recurring: !!body?.recurring,
    });
    return NextResponse.json({ holiday }, { status: 201 });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
