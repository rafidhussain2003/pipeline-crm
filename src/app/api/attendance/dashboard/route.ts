import { NextResponse } from "next/server";
import { requireAttendance } from "@/lib/attendance/guard";
import { attendanceDashboard } from "@/lib/attendance";

export async function GET() {
  const auth = await requireAttendance("attendance:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json(await attendanceDashboard(auth.session.companyId));
}
