// Phase 20 — ShiftService: shift definitions + per-user assignment.
import { db } from "@/db";
import { attendanceAssignments, attendanceSettings, attendanceShifts, companies } from "@/db/schema";
import { and, asc, count, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { AttendanceError } from "./types";
import { logAttendance } from "./logs";

// Default shift catalog every company starts with (editable, not deletable).
const SYSTEM_SHIFTS = [
  { name: "Morning", startMinute: 9 * 60, endMinute: 17 * 60 },
  { name: "Evening", startMinute: 14 * 60, endMinute: 22 * 60 },
  { name: "Night", startMinute: 22 * 60, endMinute: 6 * 60 }, // crosses midnight
  { name: "Flexible", startMinute: 0, endMinute: 0, flexible: true },
];

// Idempotent per-company bootstrap: system shifts + settings row (default
// shift = Morning). Safe under concurrent first requests.
export async function ensureAttendanceSetup(companyId: string): Promise<boolean> {
  const inserted = await db
    .insert(attendanceShifts)
    .values(SYSTEM_SHIFTS.map((s) => ({ companyId, name: s.name, startMinute: s.startMinute, endMinute: s.endMinute, flexible: s.flexible ?? false, isSystem: true })))
    .onConflictDoNothing()
    .returning({ id: attendanceShifts.id, name: attendanceShifts.name });
  const morning = inserted.find((s) => s.name === "Morning");
  await db.insert(attendanceSettings).values({ companyId, defaultShiftId: morning?.id ?? null }).onConflictDoNothing();
  return inserted.length === SYSTEM_SHIFTS.length;
}

export async function listShifts(companyId: string) {
  return db.select().from(attendanceShifts).where(eq(attendanceShifts.companyId, companyId)).orderBy(asc(attendanceShifts.startMinute));
}

export async function getShift(companyId: string, shiftId: string) {
  const [row] = await db.select().from(attendanceShifts).where(and(eq(attendanceShifts.id, shiftId), eq(attendanceShifts.companyId, companyId))).limit(1);
  return row ?? null;
}

function validateShiftInput(input: { name?: string; startMinute?: number; endMinute?: number; graceMinutes?: number; veryLateMinutes?: number; earlyLeaveMinutes?: number }) {
  const minuteOk = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 1439;
  if (input.startMinute !== undefined && !minuteOk(input.startMinute)) throw new AttendanceError("Shift start must be between 00:00 and 23:59");
  if (input.endMinute !== undefined && !minuteOk(input.endMinute)) throw new AttendanceError("Shift end must be between 00:00 and 23:59");
  for (const k of ["graceMinutes", "veryLateMinutes", "earlyLeaveMinutes"] as const) {
    const v = input[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 480)) throw new AttendanceError("Grace/threshold minutes must be 0–480");
  }
}

export async function createShift(
  companyId: string,
  actorUserId: string,
  input: { name: string; startMinute: number; endMinute: number; graceMinutes?: number; veryLateMinutes?: number; earlyLeaveMinutes?: number; flexible?: boolean; timezone?: string | null },
) {
  if (!input.name?.trim()) throw new AttendanceError("Shift name is required");
  validateShiftInput(input);
  try {
    const [row] = await db
      .insert(attendanceShifts)
      .values({
        companyId,
        name: input.name.trim(),
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        graceMinutes: input.graceMinutes ?? 10,
        veryLateMinutes: input.veryLateMinutes ?? 30,
        earlyLeaveMinutes: input.earlyLeaveMinutes ?? 15,
        flexible: input.flexible ?? false,
        timezone: input.timezone || null,
      })
      .returning();
    await recordAudit({ companyId, userId: actorUserId, action: "attendance.shift_created", entityType: "attendance_shift", entityId: row.id, after: { name: row.name, startMinute: row.startMinute, endMinute: row.endMinute } });
    return row;
  } catch (err) {
    const text = err instanceof Error ? `${err.message} ${(err.cause as Error | undefined)?.message ?? ""}` : "";
    if (/attendance_shifts_company_name_uniq|duplicate key/.test(text)) throw new AttendanceError(`A shift named "${input.name}" already exists`);
    throw err;
  }
}

export async function updateShift(
  companyId: string,
  actorUserId: string,
  shiftId: string,
  patch: { name?: string; startMinute?: number; endMinute?: number; graceMinutes?: number; veryLateMinutes?: number; earlyLeaveMinutes?: number; flexible?: boolean; timezone?: string | null; active?: boolean },
) {
  const shift = await getShift(companyId, shiftId);
  if (!shift) throw new AttendanceError("Shift not found", 404);
  validateShiftInput(patch);
  const [row] = await db
    .update(attendanceShifts)
    .set({ ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), updatedAt: new Date() })
    .where(and(eq(attendanceShifts.id, shiftId), eq(attendanceShifts.companyId, companyId)))
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "attendance.shift_updated", entityType: "attendance_shift", entityId: shiftId, before: { name: shift.name, startMinute: shift.startMinute, endMinute: shift.endMinute, active: shift.active }, after: patch });
  return row;
}

export async function deleteShift(companyId: string, actorUserId: string, shiftId: string): Promise<void> {
  const shift = await getShift(companyId, shiftId);
  if (!shift) throw new AttendanceError("Shift not found", 404);
  if (shift.isSystem) throw new AttendanceError("Default shifts cannot be deleted. Deactivate instead.");
  const [assigned] = await db.select({ n: count() }).from(attendanceAssignments).where(eq(attendanceAssignments.shiftId, shiftId));
  if (assigned.n > 0) throw new AttendanceError("This shift is assigned to employees and cannot be deleted");
  await db.delete(attendanceShifts).where(and(eq(attendanceShifts.id, shiftId), eq(attendanceShifts.companyId, companyId)));
  await recordAudit({ companyId, userId: actorUserId, action: "attendance.shift_deleted", entityType: "attendance_shift", entityId: shiftId, before: { name: shift.name } });
}

// Assign (or clear) a user's current shift.
export async function assignShift(companyId: string, actorUserId: string, userId: string, shiftId: string | null) {
  if (shiftId) {
    const shift = await getShift(companyId, shiftId);
    if (!shift) throw new AttendanceError("Shift not found", 404);
    if (!shift.active) throw new AttendanceError("This shift is inactive");
  }
  const [row] = await db
    .insert(attendanceAssignments)
    .values({ companyId, userId, shiftId, effectiveFrom: new Date().toISOString().slice(0, 10) })
    .onConflictDoUpdate({ target: [attendanceAssignments.companyId, attendanceAssignments.userId], set: { shiftId, updatedAt: new Date() } })
    .returning();
  await logAttendance({ companyId, userId, actorUserId, action: "shift_assigned", metadata: { shiftId } });
  await recordAudit({ companyId, userId: actorUserId, action: "attendance.shift_assigned", entityType: "attendance_assignment", entityId: row.id, after: { userId, shiftId } });
  return row;
}

// Resolve the shift a user works today: their assignment, else the company
// default, else null (no evaluation — treated as flexible).
export async function resolveShiftFor(companyId: string, userId: string) {
  const [assignment] = await db
    .select({ shiftId: attendanceAssignments.shiftId })
    .from(attendanceAssignments)
    .where(and(eq(attendanceAssignments.companyId, companyId), eq(attendanceAssignments.userId, userId)))
    .limit(1);
  let shiftId = assignment?.shiftId ?? null;
  if (!shiftId) {
    const [settings] = await db.select({ defaultShiftId: attendanceSettings.defaultShiftId }).from(attendanceSettings).where(eq(attendanceSettings.companyId, companyId)).limit(1);
    shiftId = settings?.defaultShiftId ?? null;
  }
  return shiftId ? getShift(companyId, shiftId) : null;
}

// The timezone a shift evaluates in: shift's own, else company's, else UTC.
export async function shiftTimezone(companyId: string, shift: { timezone?: string | null } | null): Promise<string> {
  if (shift?.timezone) return shift.timezone;
  const [company] = await db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, companyId)).limit(1);
  return company?.timezone || "UTC";
}
