// Phase 20 — AttendanceService: check-in/out, breaks, manual adjustments,
// the dashboard aggregates, and getWorkSummary — the seam Payroll (Phase 21+)
// will consume. All times land as timestamps; all derived figures (late
// status, break minutes, worked minutes) are computed ONCE when they become
// final and stored on the day record.
import { db } from "@/db";
import { attendanceBreaks, attendanceLeaveRequests, attendanceRecords, attendanceShifts, users } from "@/db/schema";
import { and, asc, count, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { AttendanceError, dateInTz, minutesBetween, minutesInTz, type ShiftLike } from "./types";
import { evaluateCheckIn, evaluateCheckOut } from "./shift-engine";
import { resolveShiftFor, shiftTimezone, ensureAttendanceSetup } from "./shifts";
import { logAttendance } from "./logs";
import { isHoliday, upcomingHolidays } from "./holidays";

export interface CheckInContext {
  ip?: string | null;
  userAgent?: string | null;
  timezone?: string | null; // browser-reported, informational
  location?: Record<string, unknown> | null; // placeholder
  device?: string | null; // placeholder
}

async function openRecordFor(companyId: string, userId: string) {
  const [rec] = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.companyId, companyId), eq(attendanceRecords.userId, userId), isNull(attendanceRecords.checkOutAt)))
    .orderBy(desc(attendanceRecords.checkInAt))
    .limit(1);
  return rec ?? null;
}

export async function checkIn(companyId: string, userId: string, ctx: CheckInContext = {}) {
  await ensureAttendanceSetup(companyId);
  const open = await openRecordFor(companyId, userId);
  if (open) throw new AttendanceError("You are already checked in. Check out first.");

  const shift = await resolveShiftFor(companyId, userId);
  const tz = await shiftTimezone(companyId, shift);
  const now = new Date();
  const workDate = dateInTz(now, tz);

  const evaluation = shift
    ? evaluateCheckIn(shift as ShiftLike, minutesInTz(now, tz))
    : { lateStatus: "on_time" as const, lateMinutes: 0 };

  try {
    const [rec] = await db
      .insert(attendanceRecords)
      .values({
        companyId,
        userId,
        workDate,
        shiftId: shift?.id ?? null,
        checkInAt: now,
        checkInTimezone: ctx.timezone || tz,
        checkInIp: ctx.ip?.slice(0, 64) || null,
        checkInUserAgent: ctx.userAgent?.slice(0, 255) || null,
        checkInLocation: ctx.location ?? null,
        checkInDevice: ctx.device?.slice(0, 80) || null,
        lateStatus: evaluation.lateStatus,
        lateMinutes: evaluation.lateMinutes,
      })
      .returning();
    await logAttendance({ companyId, userId, recordId: rec.id, action: "check_in", metadata: { lateStatus: rec.lateStatus, lateMinutes: rec.lateMinutes, workDate } });
    return rec;
  } catch (err) {
    const text = err instanceof Error ? `${err.message} ${(err.cause as Error | undefined)?.message ?? ""}` : "";
    if (/attendance_records_company_user_date_uniq|duplicate key/.test(text)) {
      throw new AttendanceError("You already have an attendance record for today.");
    }
    throw err;
  }
}

export async function checkOut(companyId: string, userId: string) {
  const rec = await openRecordFor(companyId, userId);
  if (!rec) throw new AttendanceError("You are not checked in.");
  const now = new Date();

  // Auto-close a break left running — its time still counts as break.
  const [openBreak] = await db
    .select()
    .from(attendanceBreaks)
    .where(and(eq(attendanceBreaks.recordId, rec.id), isNull(attendanceBreaks.endAt)))
    .limit(1);
  let extraBreak = 0;
  if (openBreak) {
    extraBreak = minutesBetween(openBreak.startAt, now);
    await db.update(attendanceBreaks).set({ endAt: now, durationMinutes: extraBreak }).where(eq(attendanceBreaks.id, openBreak.id));
  }
  const breakMinutes = rec.breakMinutes + extraBreak;
  const grossMinutes = minutesBetween(rec.checkInAt, now);
  const workedMinutes = Math.max(0, grossMinutes - breakMinutes);

  let departureStatus: string = "normal";
  let earlyMinutes = 0;
  if (rec.shiftId) {
    const [shift] = await db.select().from(attendanceShifts).where(eq(attendanceShifts.id, rec.shiftId)).limit(1);
    if (shift) {
      const tz = await shiftTimezone(companyId, shift);
      const checkedOutNextDay = dateInTz(now, tz) !== rec.workDate;
      const evaluation = evaluateCheckOut(shift as ShiftLike, minutesInTz(now, tz), checkedOutNextDay);
      departureStatus = evaluation.departureStatus;
      earlyMinutes = evaluation.earlyMinutes;
    }
  }

  const [updated] = await db
    .update(attendanceRecords)
    .set({ checkOutAt: now, breakMinutes, workedMinutes, departureStatus, earlyMinutes, updatedAt: new Date() })
    .where(eq(attendanceRecords.id, rec.id))
    .returning();
  await logAttendance({ companyId, userId, recordId: rec.id, action: "check_out", metadata: { workedMinutes, breakMinutes, departureStatus } });
  return updated;
}

export async function startBreak(companyId: string, userId: string) {
  const rec = await openRecordFor(companyId, userId);
  if (!rec) throw new AttendanceError("Check in before starting a break.");
  const [openBreak] = await db.select({ id: attendanceBreaks.id }).from(attendanceBreaks).where(and(eq(attendanceBreaks.recordId, rec.id), isNull(attendanceBreaks.endAt))).limit(1);
  if (openBreak) throw new AttendanceError("A break is already running.");
  const [row] = await db.insert(attendanceBreaks).values({ recordId: rec.id, companyId, startAt: new Date() }).returning();
  await logAttendance({ companyId, userId, recordId: rec.id, action: "break_start" });
  return row;
}

export async function endBreak(companyId: string, userId: string) {
  const rec = await openRecordFor(companyId, userId);
  if (!rec) throw new AttendanceError("You are not checked in.");
  const [openBreak] = await db.select().from(attendanceBreaks).where(and(eq(attendanceBreaks.recordId, rec.id), isNull(attendanceBreaks.endAt))).limit(1);
  if (!openBreak) throw new AttendanceError("No break is running.");
  const now = new Date();
  const durationMinutes = minutesBetween(openBreak.startAt, now);
  await db.update(attendanceBreaks).set({ endAt: now, durationMinutes }).where(eq(attendanceBreaks.id, openBreak.id));
  const [updated] = await db
    .update(attendanceRecords)
    .set({ breakMinutes: rec.breakMinutes + durationMinutes, updatedAt: new Date() })
    .where(eq(attendanceRecords.id, rec.id))
    .returning();
  await logAttendance({ companyId, userId, recordId: rec.id, action: "break_end", metadata: { durationMinutes } });
  return updated;
}

// The employee's own live view (Today page).
export async function todayStatus(companyId: string, userId: string) {
  const shift = await resolveShiftFor(companyId, userId);
  const tz = await shiftTimezone(companyId, shift);
  const today = dateInTz(new Date(), tz);
  const [rec] = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.companyId, companyId), eq(attendanceRecords.userId, userId), eq(attendanceRecords.workDate, today)))
    .limit(1);
  const breaks = rec
    ? await db.select().from(attendanceBreaks).where(eq(attendanceBreaks.recordId, rec.id)).orderBy(asc(attendanceBreaks.startAt))
    : [];
  return { record: rec ?? null, breaks, shift, timezone: tz, workDate: today, onBreak: breaks.some((b) => !b.endAt) };
}

// ── Manual adjustments (admins) ─────────────────────────────────────────────
// Reason is REQUIRED; before/after go to both the attendance log and the
// platform audit log; worked minutes are recomputed from the corrected times.
export async function manualAdjust(
  companyId: string,
  actorUserId: string,
  recordId: string,
  patch: { checkInAt?: string; checkOutAt?: string | null; lateStatus?: string; departureStatus?: string; notes?: string | null },
  reason: string,
) {
  if (!reason?.trim()) throw new AttendanceError("A reason is required for manual adjustments");
  const [rec] = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.id, recordId), eq(attendanceRecords.companyId, companyId))).limit(1);
  if (!rec) throw new AttendanceError("Attendance record not found", 404);

  const checkInAt = patch.checkInAt ? new Date(patch.checkInAt) : rec.checkInAt;
  if (Number.isNaN(checkInAt.getTime())) throw new AttendanceError("Invalid check-in time");
  let checkOutAt: Date | null = rec.checkOutAt;
  if (patch.checkOutAt !== undefined) {
    checkOutAt = patch.checkOutAt === null ? null : new Date(patch.checkOutAt);
    if (checkOutAt && Number.isNaN(checkOutAt.getTime())) throw new AttendanceError("Invalid check-out time");
  }
  if (checkOutAt && checkOutAt <= checkInAt) throw new AttendanceError("Check-out must be after check-in");
  if (patch.lateStatus && !["on_time", "late", "very_late"].includes(patch.lateStatus)) throw new AttendanceError("Invalid late status");
  if (patch.departureStatus && !["normal", "left_early", "overtime"].includes(patch.departureStatus)) throw new AttendanceError("Invalid departure status");

  const workedMinutes = checkOutAt ? Math.max(0, minutesBetween(checkInAt, checkOutAt) - rec.breakMinutes) : null;
  const before = { checkInAt: rec.checkInAt, checkOutAt: rec.checkOutAt, lateStatus: rec.lateStatus, departureStatus: rec.departureStatus, workedMinutes: rec.workedMinutes };
  const after = { checkInAt, checkOutAt, lateStatus: patch.lateStatus ?? rec.lateStatus, departureStatus: patch.departureStatus ?? rec.departureStatus, workedMinutes };

  const [updated] = await db
    .update(attendanceRecords)
    .set({
      checkInAt,
      checkOutAt,
      workedMinutes,
      lateStatus: patch.lateStatus ?? rec.lateStatus,
      departureStatus: patch.departureStatus ?? rec.departureStatus,
      notes: patch.notes !== undefined ? patch.notes : rec.notes,
      manualAdjusted: true,
      updatedAt: new Date(),
    })
    .where(eq(attendanceRecords.id, recordId))
    .returning();

  await logAttendance({ companyId, userId: rec.userId, actorUserId, recordId, action: "manual_adjustment", metadata: { reason: reason.trim(), before, after } });
  await recordAudit({ companyId, userId: actorUserId, action: "attendance.manual_adjustment", entityType: "attendance_record", entityId: recordId, before, after: { ...after, reason: reason.trim() } });
  return updated;
}

// ── Listings ────────────────────────────────────────────────────────────────
export async function listRecords(companyId: string, opts: { userId?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) {
  const where = [eq(attendanceRecords.companyId, companyId)];
  if (opts.userId) where.push(eq(attendanceRecords.userId, opts.userId));
  if (opts.from) where.push(gte(attendanceRecords.workDate, opts.from));
  if (opts.to) where.push(lte(attendanceRecords.workDate, opts.to));
  return db
    .select({
      id: attendanceRecords.id,
      userId: attendanceRecords.userId,
      userName: users.name,
      workDate: attendanceRecords.workDate,
      checkInAt: attendanceRecords.checkInAt,
      checkOutAt: attendanceRecords.checkOutAt,
      lateStatus: attendanceRecords.lateStatus,
      lateMinutes: attendanceRecords.lateMinutes,
      departureStatus: attendanceRecords.departureStatus,
      breakMinutes: attendanceRecords.breakMinutes,
      workedMinutes: attendanceRecords.workedMinutes,
      manualAdjusted: attendanceRecords.manualAdjusted,
      shiftName: attendanceShifts.name,
    })
    .from(attendanceRecords)
    .innerJoin(users, eq(users.id, attendanceRecords.userId))
    .leftJoin(attendanceShifts, eq(attendanceShifts.id, attendanceRecords.shiftId))
    .where(and(...where))
    .orderBy(desc(attendanceRecords.workDate), desc(attendanceRecords.checkInAt))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export async function attendanceDashboard(companyId: string) {
  await ensureAttendanceSetup(companyId);
  const tz = await shiftTimezone(companyId, null);
  const today = dateInTz(new Date(), tz);
  const monthStart = today.slice(0, 8) + "01";

  const [activeUsers] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.active, true), isNull(users.deletedAt)));

  const todays = await db
    .select({
      id: attendanceRecords.id,
      checkOutAt: attendanceRecords.checkOutAt,
      lateStatus: attendanceRecords.lateStatus,
    })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.companyId, companyId), eq(attendanceRecords.workDate, today)));

  const [onBreakRows] = await db
    .select({ n: count() })
    .from(attendanceBreaks)
    .innerJoin(attendanceRecords, eq(attendanceRecords.id, attendanceBreaks.recordId))
    .where(and(eq(attendanceBreaks.companyId, companyId), isNull(attendanceBreaks.endAt), eq(attendanceRecords.workDate, today)));

  const [onLeaveRows] = await db
    .select({ n: count() })
    .from(attendanceLeaveRequests)
    .where(
      and(
        eq(attendanceLeaveRequests.companyId, companyId),
        eq(attendanceLeaveRequests.status, "approved"),
        lte(attendanceLeaveRequests.startDate, today),
        gte(attendanceLeaveRequests.endDate, today),
      ),
    );

  const [pendingLeaves] = await db
    .select({ n: count() })
    .from(attendanceLeaveRequests)
    .where(and(eq(attendanceLeaveRequests.companyId, companyId), eq(attendanceLeaveRequests.status, "pending")));

  const [avg] = await db
    .select({ avgWorked: sql<string>`coalesce(avg(${attendanceRecords.workedMinutes}), 0)` })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.companyId, companyId), gte(attendanceRecords.workDate, monthStart), sql`${attendanceRecords.workedMinutes} is not null`));

  const holiday = await isHoliday(companyId, today);
  const present = todays.length;
  const checkedOut = todays.filter((r) => r.checkOutAt).length;
  const checkedIn = present - checkedOut;
  const late = todays.filter((r) => r.lateStatus === "late" || r.lateStatus === "very_late").length;
  const onLeave = onLeaveRows.n;
  // Absent = everyone who neither showed up nor is on approved leave — but a
  // holiday means nobody is "absent".
  const absent = holiday ? 0 : Math.max(0, activeUsers.n - present - onLeave);

  return {
    totalEmployees: activeUsers.n,
    present,
    absent,
    late,
    onLeave,
    checkedIn,
    checkedOut,
    currentlyWorking: Math.max(0, checkedIn - onBreakRows.n),
    onBreak: onBreakRows.n,
    avgWorkedMinutes: Math.round(Number(avg.avgWorked)),
    todayIsHoliday: holiday,
    upcomingHolidays: await upcomingHolidays(companyId, 3),
    pendingLeaveRequests: pendingLeaves.n,
    workDate: today,
  };
}

// ── THE PAYROLL SEAM (Phase 21+ consumes exactly this) ──────────────────────
// Everything a pay run needs for one employee over a period, from stored
// facts: worked minutes, present/late/absent days, leave days by type, shift
// history, holidays — no recalculation of attendance rules.
export async function getWorkSummary(companyId: string, userId: string, from: string, to: string) {
  const records = await db
    .select({
      workDate: attendanceRecords.workDate,
      workedMinutes: attendanceRecords.workedMinutes,
      breakMinutes: attendanceRecords.breakMinutes,
      lateStatus: attendanceRecords.lateStatus,
      departureStatus: attendanceRecords.departureStatus,
      shiftId: attendanceRecords.shiftId,
      shiftName: attendanceShifts.name,
    })
    .from(attendanceRecords)
    .leftJoin(attendanceShifts, eq(attendanceShifts.id, attendanceRecords.shiftId))
    .where(and(eq(attendanceRecords.companyId, companyId), eq(attendanceRecords.userId, userId), gte(attendanceRecords.workDate, from), lte(attendanceRecords.workDate, to)))
    .orderBy(asc(attendanceRecords.workDate));

  const leaves = await db
    .select({ type: attendanceLeaveRequests.type, startDate: attendanceLeaveRequests.startDate, endDate: attendanceLeaveRequests.endDate })
    .from(attendanceLeaveRequests)
    .where(
      and(
        eq(attendanceLeaveRequests.companyId, companyId),
        eq(attendanceLeaveRequests.userId, userId),
        eq(attendanceLeaveRequests.status, "approved"),
        lte(attendanceLeaveRequests.startDate, to),
        gte(attendanceLeaveRequests.endDate, from),
      ),
    );

  const leaveDaysByType: Record<string, number> = {};
  for (const l of leaves) {
    const start = l.startDate < from ? from : l.startDate;
    const end = l.endDate > to ? to : l.endDate;
    const days = Math.round((new Date(end + "T00:00:00Z").getTime() - new Date(start + "T00:00:00Z").getTime()) / 86_400_000) + 1;
    leaveDaysByType[l.type] = (leaveDaysByType[l.type] ?? 0) + days;
  }

  return {
    from,
    to,
    totalWorkedMinutes: records.reduce((s, r) => s + (r.workedMinutes ?? 0), 0),
    totalBreakMinutes: records.reduce((s, r) => s + r.breakMinutes, 0),
    presentDays: records.length,
    lateDays: records.filter((r) => r.lateStatus === "late" || r.lateStatus === "very_late").length,
    leftEarlyDays: records.filter((r) => r.departureStatus === "left_early").length,
    leaveDays: Object.values(leaveDaysByType).reduce((s, n) => s + n, 0),
    leaveDaysByType,
    shiftHistory: records.map((r) => ({ workDate: r.workDate, shiftId: r.shiftId, shiftName: r.shiftName, workedMinutes: r.workedMinutes })),
  };
}
