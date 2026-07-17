// Phase 22 — DepartmentService. Hierarchy-ready via a self parent.
import { db } from "@/db";
import { hrDepartments, hrDesignations, hrEmployees, users } from "@/db/schema";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { HRError, validateCode } from "./types";

export async function getDepartment(companyId: string, id: string) {
  const [row] = await db.select().from(hrDepartments).where(and(eq(hrDepartments.id, id), eq(hrDepartments.companyId, companyId))).limit(1);
  return row ?? null;
}

export async function listDepartments(companyId: string) {
  return db
    .select({
      id: hrDepartments.id,
      name: hrDepartments.name,
      code: hrDepartments.code,
      parentId: hrDepartments.parentId,
      managerUserId: hrDepartments.managerUserId,
      managerName: users.name,
      active: hrDepartments.active,
      // Live headcount per department, as a correlated subquery.
      headcount: sql<number>`(select count(*) from hr_employees e where e.department_id = ${hrDepartments.id})::int`,
    })
    .from(hrDepartments)
    .leftJoin(users, eq(users.id, hrDepartments.managerUserId))
    .where(eq(hrDepartments.companyId, companyId))
    .orderBy(asc(hrDepartments.name));
}

export async function createDepartment(companyId: string, actorUserId: string, input: { name: string; code: string; parentId?: string | null; managerUserId?: string | null }) {
  if (!input.name?.trim()) throw new HRError("Department name is required");
  const code = validateCode(input.code, "Department code");
  if (input.parentId) {
    const parent = await getDepartment(companyId, input.parentId);
    if (!parent) throw new HRError("Parent department not found", 404);
  }
  if (input.managerUserId) await assertCompanyUser(companyId, input.managerUserId);
  try {
    const [row] = await db.insert(hrDepartments).values({ companyId, name: input.name.trim(), code, parentId: input.parentId ?? null, managerUserId: input.managerUserId ?? null }).returning();
    await recordAudit({ companyId, userId: actorUserId, action: "hr.department_created", entityType: "hr_department", entityId: row.id, after: { name: row.name, code: row.code } });
    return row;
  } catch (err) {
    if (isDup(err, "hr_departments_company_code_uniq")) throw new HRError(`Department code "${input.code}" is already in use`);
    throw err;
  }
}

export async function updateDepartment(companyId: string, actorUserId: string, id: string, patch: { name?: string; parentId?: string | null; managerUserId?: string | null; active?: boolean }) {
  const dept = await getDepartment(companyId, id);
  if (!dept) throw new HRError("Department not found", 404);
  if (patch.parentId) {
    if (patch.parentId === id) throw new HRError("A department cannot be its own parent");
    const parent = await getDepartment(companyId, patch.parentId);
    if (!parent) throw new HRError("Parent department not found", 404);
  }
  if (patch.managerUserId) await assertCompanyUser(companyId, patch.managerUserId);
  const [row] = await db
    .update(hrDepartments)
    .set({ ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}), ...(patch.managerUserId !== undefined ? { managerUserId: patch.managerUserId } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}), updatedAt: new Date() })
    .where(and(eq(hrDepartments.id, id), eq(hrDepartments.companyId, companyId)))
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "hr.department_updated", entityType: "hr_department", entityId: id, before: { name: dept.name, active: dept.active }, after: patch });
  return row;
}

// Cannot delete a department that has employees, child departments, or
// designations attached — deactivate instead.
export async function deleteDepartment(companyId: string, actorUserId: string, id: string): Promise<void> {
  const dept = await getDepartment(companyId, id);
  if (!dept) throw new HRError("Department not found", 404);
  const [emp] = await db.select({ n: count() }).from(hrEmployees).where(eq(hrEmployees.departmentId, id));
  if (emp.n > 0) throw new HRError("This department has employees and cannot be deleted. Deactivate it instead.");
  const [children] = await db.select({ n: count() }).from(hrDepartments).where(eq(hrDepartments.parentId, id));
  if (children.n > 0) throw new HRError("This department has sub-departments and cannot be deleted");
  const [desig] = await db.select({ n: count() }).from(hrDesignations).where(eq(hrDesignations.departmentId, id));
  if (desig.n > 0) throw new HRError("This department has designations and cannot be deleted");
  await db.delete(hrDepartments).where(and(eq(hrDepartments.id, id), eq(hrDepartments.companyId, companyId)));
  await recordAudit({ companyId, userId: actorUserId, action: "hr.department_deleted", entityType: "hr_department", entityId: id, before: { name: dept.name, code: dept.code } });
}

// ── small shared helpers (also used by designation/employee services) ───────
export async function assertCompanyUser(companyId: string, userId: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.companyId, companyId))).limit(1);
  if (!u) throw new HRError("That user is not part of this company", 404);
}
export function isDup(err: unknown, constraint: string): boolean {
  const text = err instanceof Error ? `${err.message} ${(err.cause as Error | undefined)?.message ?? ""}` : "";
  return new RegExp(`${constraint}|duplicate key`).test(text);
}
