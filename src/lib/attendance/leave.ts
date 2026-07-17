// Phase 20 — LeaveService: request → approve/reject/cancel, with balance
// placeholders (structure ready for future per-type allowances).
import { db } from "@/db";
import { attendanceLeaveRequests, users } from "@/db/schema";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { AttendanceError, LEAVE_TYPES, isValidDateStr, type LeaveType } from "./types";
import { logAttendance } from "./logs";

export async function requestLeave(companyId: string, userId: string, input: { type: string; startDate: string; endDate: string; reason?: string | null }) {
  if (!LEAVE_TYPES.includes(input.type as LeaveType)) throw new AttendanceError("Invalid leave type");
  if (!isValidDateStr(input.startDate) || !isValidDateStr(input.endDate)) throw new AttendanceError("Valid start and end dates are required");
  if (input.startDate > input.endDate) throw new AttendanceError("The start date must not be after the end date");

  // No overlapping open (pending/approved) request for the same person.
  const [overlap] = await db
    .select({ id: attendanceLeaveRequests.id })
    .from(attendanceLeaveRequests)
    .where(
      and(
        eq(attendanceLeaveRequests.companyId, companyId),
        eq(attendanceLeaveRequests.userId, userId),
        inArray(attendanceLeaveRequests.status, ["pending", "approved"]),
        lte(attendanceLeaveRequests.startDate, input.endDate),
        gte(attendanceLeaveRequests.endDate, input.startDate),
      ),
    )
    .limit(1);
  if (overlap) throw new AttendanceError("You already have a leave request covering part of this range");

  const [row] = await db
    .insert(attendanceLeaveRequests)
    .values({ companyId, userId, type: input.type, startDate: input.startDate, endDate: input.endDate, reason: input.reason?.trim() || null })
    .returning();
  await logAttendance({ companyId, userId, action: "leave_requested", metadata: { type: row.type, startDate: row.startDate, endDate: row.endDate } });
  return row;
}

export async function decideLeave(companyId: string, actorUserId: string, leaveId: string, decision: "approved" | "rejected", note?: string) {
  const [leave] = await db.select().from(attendanceLeaveRequests).where(and(eq(attendanceLeaveRequests.id, leaveId), eq(attendanceLeaveRequests.companyId, companyId))).limit(1);
  if (!leave) throw new AttendanceError("Leave request not found", 404);
  if (leave.status !== "pending") throw new AttendanceError(`This request is already ${leave.status}`);

  const [row] = await db
    .update(attendanceLeaveRequests)
    .set({ status: decision, reviewedBy: actorUserId, reviewedAt: new Date(), reviewNote: note?.trim() || null, updatedAt: new Date() })
    .where(eq(attendanceLeaveRequests.id, leaveId))
    .returning();
  await logAttendance({ companyId, userId: leave.userId, actorUserId, action: decision === "approved" ? "leave_approved" : "leave_rejected", metadata: { leaveId, note: note ?? null } });
  await recordAudit({ companyId, userId: actorUserId, action: `attendance.leave_${decision}`, entityType: "attendance_leave", entityId: leaveId, before: { status: "pending" }, after: { status: decision, note: note ?? null } });
  return row;
}

// The requester (any status while pending) or a manager may cancel.
export async function cancelLeave(companyId: string, actorUserId: string, leaveId: string, canManage: boolean) {
  const [leave] = await db.select().from(attendanceLeaveRequests).where(and(eq(attendanceLeaveRequests.id, leaveId), eq(attendanceLeaveRequests.companyId, companyId))).limit(1);
  if (!leave) throw new AttendanceError("Leave request not found", 404);
  if (leave.userId !== actorUserId && !canManage) throw new AttendanceError("You can only cancel your own leave requests", 403);
  if (leave.status === "cancelled" || leave.status === "rejected") throw new AttendanceError(`This request is already ${leave.status}`);

  const [row] = await db
    .update(attendanceLeaveRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(attendanceLeaveRequests.id, leaveId))
    .returning();
  await logAttendance({ companyId, userId: leave.userId, actorUserId, action: "leave_cancelled", metadata: { leaveId, wasApproved: leave.status === "approved" } });
  await recordAudit({ companyId, userId: actorUserId, action: "attendance.leave_cancelled", entityType: "attendance_leave", entityId: leaveId, before: { status: leave.status }, after: { status: "cancelled" } });
  return row;
}

export async function listLeaves(companyId: string, opts: { userId?: string; status?: string; limit?: number; offset?: number } = {}) {
  const where = [eq(attendanceLeaveRequests.companyId, companyId)];
  if (opts.userId) where.push(eq(attendanceLeaveRequests.userId, opts.userId));
  if (opts.status) where.push(eq(attendanceLeaveRequests.status, opts.status));
  return db
    .select({
      id: attendanceLeaveRequests.id,
      userId: attendanceLeaveRequests.userId,
      userName: users.name,
      type: attendanceLeaveRequests.type,
      startDate: attendanceLeaveRequests.startDate,
      endDate: attendanceLeaveRequests.endDate,
      reason: attendanceLeaveRequests.reason,
      status: attendanceLeaveRequests.status,
      reviewNote: attendanceLeaveRequests.reviewNote,
      createdAt: attendanceLeaveRequests.createdAt,
    })
    .from(attendanceLeaveRequests)
    .innerJoin(users, eq(users.id, attendanceLeaveRequests.userId))
    .where(and(...where))
    .orderBy(desc(attendanceLeaveRequests.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}

// Leave balance PLACEHOLDERS: per-type usage this year is real; allowances are
// null until a future phase defines leave policies. The shape is what the UI
// and Payroll will keep.
export async function leaveBalances(companyId: string, userId: string) {
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const rows = await db
    .select({
      type: attendanceLeaveRequests.type,
      days: sql<number>`coalesce(sum((${attendanceLeaveRequests.endDate} - ${attendanceLeaveRequests.startDate}) + 1), 0)::int`,
    })
    .from(attendanceLeaveRequests)
    .where(
      and(
        eq(attendanceLeaveRequests.companyId, companyId),
        eq(attendanceLeaveRequests.userId, userId),
        eq(attendanceLeaveRequests.status, "approved"),
        gte(attendanceLeaveRequests.startDate, yearStart),
      ),
    )
    .groupBy(attendanceLeaveRequests.type);
  const used = new Map(rows.map((r) => [r.type, r.days]));
  return LEAVE_TYPES.map((type) => ({ type, usedDaysThisYear: used.get(type) ?? 0, annualAllowance: null as number | null, remaining: null as number | null }));
}
