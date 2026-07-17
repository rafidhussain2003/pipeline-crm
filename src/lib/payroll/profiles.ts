// Phase 21 — PayrollService (employee payroll profiles). One profile per
// employee, carrying their assigned salary structure, frequency, status, and
// the bank/tax placeholders.
import { db } from "@/db";
import { payrollProfiles, payrollStructures, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { isValidDateStr, PAY_FREQUENCIES, PROFILE_STATUSES, PayrollError, type PayFrequency } from "./types";
import { getStructure } from "./structures";

export async function getProfile(companyId: string, userId: string) {
  const [row] = await db.select().from(payrollProfiles).where(and(eq(payrollProfiles.companyId, companyId), eq(payrollProfiles.userId, userId))).limit(1);
  return row ?? null;
}

// The payroll roster: every active member + their profile + structure name.
export async function listProfiles(companyId: string) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      profileId: payrollProfiles.id,
      structureId: payrollProfiles.structureId,
      structureName: payrollStructures.name,
      basicCents: payrollStructures.basicCents,
      frequency: payrollProfiles.frequency,
      joiningDate: payrollProfiles.joiningDate,
      status: payrollProfiles.status,
      bankAccountRef: payrollProfiles.bankAccountRef,
      taxRef: payrollProfiles.taxRef,
      notes: payrollProfiles.notes,
    })
    .from(users)
    .leftJoin(payrollProfiles, and(eq(payrollProfiles.userId, users.id), eq(payrollProfiles.companyId, companyId)))
    .leftJoin(payrollStructures, eq(payrollStructures.id, payrollProfiles.structureId))
    .where(and(eq(users.companyId, companyId), eq(users.active, true), isNull(users.deletedAt)));
}

export interface ProfileInput {
  structureId?: string | null;
  frequency?: string;
  joiningDate?: string | null;
  status?: string;
  bankAccountRef?: string | null;
  taxRef?: string | null;
  notes?: string | null;
}

export async function upsertProfile(companyId: string, actorUserId: string, userId: string, input: ProfileInput) {
  // Target must belong to this company.
  const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.companyId, companyId))).limit(1);
  if (!target) throw new PayrollError("Employee not found", 404);

  let frequency: string | undefined = input.frequency;
  if (input.structureId) {
    const structure = await getStructure(companyId, input.structureId);
    if (!structure) throw new PayrollError("Salary structure not found", 404);
    if (!structure.active) throw new PayrollError("That salary structure has been superseded — choose the current version");
    frequency = frequency ?? structure.frequency;
  }
  if (frequency !== undefined && !PAY_FREQUENCIES.includes(frequency as PayFrequency)) throw new PayrollError("Invalid pay frequency");
  if (input.status !== undefined && !PROFILE_STATUSES.includes(input.status as (typeof PROFILE_STATUSES)[number])) throw new PayrollError("Invalid payroll status");
  if (input.joiningDate && !isValidDateStr(input.joiningDate)) throw new PayrollError("Invalid joining date");

  const existing = await getProfile(companyId, userId);
  const values = {
    companyId,
    userId,
    structureId: input.structureId !== undefined ? input.structureId : existing?.structureId ?? null,
    frequency: frequency ?? existing?.frequency ?? "monthly",
    joiningDate: input.joiningDate !== undefined ? input.joiningDate : existing?.joiningDate ?? null,
    status: input.status ?? existing?.status ?? "active",
    bankAccountRef: input.bankAccountRef !== undefined ? input.bankAccountRef : existing?.bankAccountRef ?? null,
    taxRef: input.taxRef !== undefined ? input.taxRef : existing?.taxRef ?? null,
    notes: input.notes !== undefined ? input.notes : existing?.notes ?? null,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(payrollProfiles)
    .values(values)
    .onConflictDoUpdate({ target: [payrollProfiles.companyId, payrollProfiles.userId], set: values })
    .returning();

  // "Salary changes" are audited (structure change is the salary-affecting one).
  const salaryChanged = existing?.structureId !== row.structureId;
  await recordAudit({
    companyId,
    userId: actorUserId,
    action: salaryChanged ? "payroll.salary_changed" : "payroll.profile_updated",
    entityType: "payroll_profile",
    entityId: row.id,
    before: existing ? { structureId: existing.structureId, status: existing.status, frequency: existing.frequency } : null,
    after: { structureId: row.structureId, status: row.status, frequency: row.frequency },
  });
  return row;
}
