// Phase 22 — employment types (Permanent/Contract/Intern/Part-time/Temporary
// seeded per company + custom types).
import { db } from "@/db";
import { hrEmployees, hrEmploymentTypes } from "@/db/schema";
import { and, asc, count, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { HRError, validateCode } from "./types";
import { ensureHRSetup } from "./settings";
import { isDup } from "./departments";

export async function listEmploymentTypes(companyId: string) {
  await ensureHRSetup(companyId);
  return db.select().from(hrEmploymentTypes).where(eq(hrEmploymentTypes.companyId, companyId)).orderBy(asc(hrEmploymentTypes.name));
}

export async function createEmploymentType(companyId: string, actorUserId: string, input: { name: string; code: string }) {
  if (!input.name?.trim()) throw new HRError("Type name is required");
  const code = validateCode(input.code, "Type code");
  try {
    const [row] = await db.insert(hrEmploymentTypes).values({ companyId, name: input.name.trim(), code, isSystem: false }).returning();
    await recordAudit({ companyId, userId: actorUserId, action: "hr.employment_type_created", entityType: "hr_employment_type", entityId: row.id, after: { name: row.name, code: row.code } });
    return row;
  } catch (err) {
    if (isDup(err, "hr_employment_types_company_code_uniq")) throw new HRError(`Type code "${input.code}" is already in use`);
    throw err;
  }
}

export async function deleteEmploymentType(companyId: string, actorUserId: string, id: string): Promise<void> {
  const [row] = await db.select().from(hrEmploymentTypes).where(and(eq(hrEmploymentTypes.id, id), eq(hrEmploymentTypes.companyId, companyId))).limit(1);
  if (!row) throw new HRError("Employment type not found", 404);
  if (row.isSystem) throw new HRError("Standard employment types cannot be deleted");
  const [emp] = await db.select({ n: count() }).from(hrEmployees).where(eq(hrEmployees.employmentTypeId, id));
  if (emp.n > 0) throw new HRError("This type is assigned to employees and cannot be deleted");
  await db.delete(hrEmploymentTypes).where(eq(hrEmploymentTypes.id, id));
  await recordAudit({ companyId, userId: actorUserId, action: "hr.employment_type_deleted", entityType: "hr_employment_type", entityId: id, before: { name: row.name } });
}
