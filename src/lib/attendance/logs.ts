// Phase 20 — LogService: the append-only attendance event stream. Every
// attendance action lands here (best-effort — a log failure never fails the
// action it describes).
import { db } from "@/db";
import { attendanceLogs, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { AttendanceAction } from "./types";

export async function logAttendance(params: {
  companyId: string;
  userId: string;
  actorUserId?: string | null;
  recordId?: string | null;
  action: AttendanceAction;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(attendanceLogs).values({
      companyId: params.companyId,
      userId: params.userId,
      actorUserId: params.actorUserId ?? params.userId,
      recordId: params.recordId ?? null,
      action: params.action,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    console.error("Failed to write attendance log:", err);
  }
}

export async function listAttendanceLogs(companyId: string, opts: { userId?: string; action?: string; limit?: number; offset?: number } = {}) {
  const where = [eq(attendanceLogs.companyId, companyId)];
  if (opts.userId) where.push(eq(attendanceLogs.userId, opts.userId));
  if (opts.action) where.push(eq(attendanceLogs.action, opts.action));
  return db
    .select({
      id: attendanceLogs.id,
      userId: attendanceLogs.userId,
      actorUserId: attendanceLogs.actorUserId,
      recordId: attendanceLogs.recordId,
      action: attendanceLogs.action,
      metadata: attendanceLogs.metadata,
      createdAt: attendanceLogs.createdAt,
      userName: users.name,
    })
    .from(attendanceLogs)
    .innerJoin(users, eq(users.id, attendanceLogs.userId))
    .where(and(...where))
    .orderBy(desc(attendanceLogs.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
}
