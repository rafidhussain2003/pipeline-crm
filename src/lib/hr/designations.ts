// Phase 22 — DesignationService (job titles).
import { db } from "@/db";
import { hrDepartments, hrDesignations, hrEmployees } from "@/db/schema";
import { and, asc, count, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { HRError, validateCode } from "./types";
import { getDepartment, isDup } from "./departments";

export async function getDesignation(companyId: string, id: string) {
  const [row] = await db.select().from(hrDesignations).where(and(eq(hrDesignations.id, id), eq(hrDesignations.companyId, companyId))).limit(1);
  return row ?? null;
}

export async function listDesignations(companyId: string) {
  return db
    .select({
      id: hrDesignations.id,
      title: hrDesignations.title,
      code: hrDesignations.code,
      departmentId: hrDesignations.departmentId,
      departmentName: hrDepartments.name,
      level: hrDesignations.level,
      active: hrDesignations.active,
    })
    .from(hrDesignations)
    .leftJoin(hrDepartments, eq(hrDepartments.id, hrDesignations.departmentId))
    .where(eq(hrDesignations.companyId, companyId))
    .orderBy(asc(hrDesignations.level), asc(hrDesignations.title));
}

export async function createDesignation(companyId: string, actorUserId: string, input: { title: string; code: string; departmentId?: string | null; level?: number }) {
  if (!input.title?.trim()) throw new HRError("Designation title is required");
  const code = validateCode(input.code, "Designation code");
  const level = Number(input.level ?? 5);
  if (!Number.isInteger(level) || level < 1 || level > 20) throw new HRError("Hierarchy level must be 1-20 (1 = most senior)");
  if (input.departmentId && !(await getDepartment(companyId, input.departmentId))) throw new HRError("Department not found", 404);
  try {
    const [row] = await db.insert(hrDesignations).values({ companyId, title: input.title.trim(), code, departmentId: input.departmentId ?? null, level }).returning();
    await recordAudit({ companyId, userId: actorUserId, action: "hr.designation_created", entityType: "hr_designation", entityId: row.id, after: { title: row.title, code: row.code, level } });
    return row;
  } catch (err) {
    if (isDup(err, "hr_designations_company_code_uniq")) throw new HRError(`Designation code "${input.code}" is already in use`);
    throw err;
  }
}

export async function updateDesignation(companyId: string, actorUserId: string, id: string, patch: { title?: string; departmentId?: string | null; level?: number; active?: boolean }) {
  const d = await getDesignation(companyId, id);
  if (!d) throw new HRError("Designation not found", 404);
  if (patch.level !== undefined && (!Number.isInteger(patch.level) || patch.level < 1 || patch.level > 20)) throw new HRError("Hierarchy level must be 1-20");
  if (patch.departmentId && !(await getDepartment(companyId, patch.departmentId))) throw new HRError("Department not found", 404);
  const [row] = await db
    .update(hrDesignations)
    .set({ ...(patch.title !== undefined ? { title: patch.title.trim() } : {}), ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}), ...(patch.level !== undefined ? { level: patch.level } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}), updatedAt: new Date() })
    .where(and(eq(hrDesignations.id, id), eq(hrDesignations.companyId, companyId)))
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "hr.designation_updated", entityType: "hr_designation", entityId: id, before: { title: d.title, level: d.level }, after: patch });
  return row;
}

export async function deleteDesignation(companyId: string, actorUserId: string, id: string): Promise<void> {
  const d = await getDesignation(companyId, id);
  if (!d) throw new HRError("Designation not found", 404);
  const [emp] = await db.select({ n: count() }).from(hrEmployees).where(eq(hrEmployees.designationId, id));
  if (emp.n > 0) throw new HRError("This designation is assigned to employees and cannot be deleted. Deactivate it instead.");
  await db.delete(hrDesignations).where(and(eq(hrDesignations.id, id), eq(hrDesignations.companyId, companyId)));
  await recordAudit({ companyId, userId: actorUserId, action: "hr.designation_deleted", entityType: "hr_designation", entityId: id, before: { title: d.title } });
}
