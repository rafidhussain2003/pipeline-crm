import { NextRequest, NextResponse } from "next/server";
import { requireAttendance, attendanceErrorResponse } from "@/lib/attendance/guard";
import { hasAttendancePermission, leaveBalances, listLeaves, requestLeave } from "@/lib/attendance";

// Employees see their own requests (+ balances); managers see the company's.
export async function GET(req: NextRequest) {
  const auth = await requireAttendance("attendance:self");
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  const canView = hasAttendancePermission(auth.session.role, "attendance:view");
  const leaves = await listLeaves(auth.session.companyId, {
    userId: canView && p.get("all") === "1" ? p.get("userId") || undefined : auth.session.userId,
    status: p.get("status") || undefined,
    limit: Number(p.get("limit")) || 50,
    offset: Number(p.get("offset")) || 0,
  });
  const balances = await leaveBalances(auth.session.companyId, auth.session.userId);
  return NextResponse.json({ leaves, balances, canManage: hasAttendancePermission(auth.session.role, "attendance:manage") });
}

export async function POST(req: NextRequest) {
  const auth = await requireAttendance("attendance:self");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const leave = await requestLeave(auth.session.companyId, auth.session.userId, {
      type: String(body?.type ?? ""),
      startDate: String(body?.startDate ?? ""),
      endDate: String(body?.endDate ?? ""),
      reason: typeof body?.reason === "string" ? body.reason : null,
    });
    return NextResponse.json({ leave }, { status: 201 });
  } catch (err) {
    return attendanceErrorResponse(err);
  }
}
