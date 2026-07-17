// Phase 20 — HolidayService: national/company/optional holidays, one-off or
// recurring (same month/day every year), future years supported by both.
import { db } from "@/db";
import { attendanceHolidays } from "@/db/schema";
import { and, asc, eq, gte } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { AttendanceError, HOLIDAY_KINDS, isValidDateStr, type HolidayKind } from "./types";

export async function listHolidays(companyId: string) {
  return db.select().from(attendanceHolidays).where(eq(attendanceHolidays.companyId, companyId)).orderBy(asc(attendanceHolidays.date));
}

export async function createHoliday(companyId: string, actorUserId: string, input: { name: string; date: string; kind?: string; recurring?: boolean }) {
  if (!input.name?.trim()) throw new AttendanceError("Holiday name is required");
  if (!isValidDateStr(input.date)) throw new AttendanceError("A valid date is required");
  const kind = (input.kind ?? "company") as HolidayKind;
  if (!HOLIDAY_KINDS.includes(kind)) throw new AttendanceError("Invalid holiday kind");
  const [row] = await db
    .insert(attendanceHolidays)
    .values({ companyId, name: input.name.trim(), date: input.date, kind, recurring: input.recurring ?? false })
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "attendance.holiday_created", entityType: "attendance_holiday", entityId: row.id, after: { name: row.name, date: row.date, kind, recurring: row.recurring } });
  return row;
}

export async function deleteHoliday(companyId: string, actorUserId: string, holidayId: string): Promise<void> {
  const [row] = await db.select().from(attendanceHolidays).where(and(eq(attendanceHolidays.id, holidayId), eq(attendanceHolidays.companyId, companyId))).limit(1);
  if (!row) throw new AttendanceError("Holiday not found", 404);
  await db.delete(attendanceHolidays).where(eq(attendanceHolidays.id, holidayId));
  await recordAudit({ companyId, userId: actorUserId, action: "attendance.holiday_deleted", entityType: "attendance_holiday", entityId: holidayId, before: { name: row.name, date: row.date } });
}

// Is a date a holiday? Exact match, or a recurring holiday from ANY year with
// the same month/day.
export async function isHoliday(companyId: string, date: string): Promise<boolean> {
  const monthDay = date.slice(5); // "MM-DD"
  const rows = await db
    .select({ date: attendanceHolidays.date, recurring: attendanceHolidays.recurring })
    .from(attendanceHolidays)
    .where(eq(attendanceHolidays.companyId, companyId));
  return rows.some((h) => h.date === date || (h.recurring && h.date.slice(5) === monthDay));
}

// Next N holidays from today, projecting recurring ones into this/next year.
export async function upcomingHolidays(companyId: string, limit = 5) {
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const rows = await db
    .select()
    .from(attendanceHolidays)
    .where(and(eq(attendanceHolidays.companyId, companyId), gte(attendanceHolidays.date, `${year - 1}-01-01`)));
  const projected: { name: string; date: string; kind: string; recurring: boolean }[] = [];
  for (const h of rows) {
    if (h.recurring) {
      for (const y of [year, year + 1]) {
        const d = `${y}-${h.date.slice(5)}`;
        if (d >= today) projected.push({ name: h.name, date: d, kind: h.kind, recurring: true });
      }
    } else if (h.date >= today) {
      projected.push({ name: h.name, date: h.date, kind: h.kind, recurring: false });
    }
  }
  const seen = new Set<string>();
  return projected
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((h) => {
      const key = `${h.date}:${h.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
