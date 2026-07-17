// Phase 22 — HR dashboard aggregates.
import { db } from "@/db";
import { attendanceLeaveRequests, hrDepartments, hrEmployees } from "@/db/schema";
import { and, count, eq, gte, lte } from "drizzle-orm";
import { ACTIVE_STATUSES } from "./types";
import { ensureHRSetup } from "./settings";

export async function hrDashboard(companyId: string) {
  await ensureHRSetup(companyId);
  const today = new Date().toISOString().slice(0, 10);
  const monthDay = today.slice(5); // MM-DD
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const employees = await db
    .select({ status: hrEmployees.employmentStatus, dob: hrEmployees.dateOfBirth, joining: hrEmployees.joiningDate })
    .from(hrEmployees)
    .where(eq(hrEmployees.companyId, companyId));

  const total = employees.length;
  const active = employees.filter((e) => ACTIVE_STATUSES.includes(e.status as (typeof ACTIVE_STATUSES)[number])).length;
  const inactive = total - active;

  const [departments] = await db.select({ n: count() }).from(hrDepartments).where(and(eq(hrDepartments.companyId, companyId), eq(hrDepartments.active, true)));

  // New joiners: joined within the last 30 days.
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const newJoiners = employees.filter((e) => e.joining && e.joining >= thirtyAgo && e.joining <= today).length;

  // Upcoming birthdays (placeholder-grade): DOB month-day within the next 30
  // days. Computed from the master, no separate store.
  const inWindow = (md: string) => {
    // handle year wrap by comparing MM-DD strings within [today, +30d]
    const end30 = in30.slice(5);
    if (today.slice(5) <= end30) return md >= monthDay && md <= end30;
    return md >= monthDay || md <= end30;
  };
  const upcomingBirthdays = employees.filter((e) => e.dob && inWindow(e.dob.slice(5))).length;
  const upcomingAnniversaries = employees.filter((e) => e.joining && e.joining < today && inWindow(e.joining.slice(5))).length;

  // Employees on leave today — read from Attendance (approved leave covering
  // today). Best-effort; independent of whether Attendance is enabled.
  let onLeave = 0;
  try {
    const [row] = await db
      .select({ n: count() })
      .from(attendanceLeaveRequests)
      .where(and(eq(attendanceLeaveRequests.companyId, companyId), eq(attendanceLeaveRequests.status, "approved"), lte(attendanceLeaveRequests.startDate, today), gte(attendanceLeaveRequests.endDate, today)));
    onLeave = row.n;
  } catch {
    onLeave = 0;
  }

  return {
    totalEmployees: total,
    activeEmployees: active,
    inactiveEmployees: inactive,
    departments: departments.n,
    newJoiners,
    upcomingBirthdays, // placeholder
    upcomingAnniversaries, // placeholder
    onLeave, // from Attendance
  };
}
