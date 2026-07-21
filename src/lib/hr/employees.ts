// Phase 22 — EmployeeService: the master employee directory. An HR employee is
// a 1:1 extension of a company `user` (userId unique); email/phone/login-name
// are read through from `users` (single source, never duplicated here).
import crypto from "crypto";
import { db } from "@/db";
import { hrDepartments, hrDesignations, hrEmployees, hrEmploymentTypes, users } from "@/db/schema";
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { checkAgentQuota } from "@/lib/tenant/limits";
import { EMPLOYMENT_STATUSES, HRError, isValidDateStr, type EmploymentStatus } from "./types";
import { assertCompanyUser, isDup } from "./departments";
import { ensureHRSetup, getHRSettings, nextEmployeeCode } from "./settings";
import { assertNoCycle } from "./organization";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Enterprise HR Workspace: "add any employee by email". Resolves the email
// to a company user — linking the existing member when the address is
// already theirs, otherwise creating the identity on the spot:
//   • role "agent", random unusable temp password, mustChangePassword set —
//     they can't sign in until an admin resets/hands them a password;
//   • moduleAccess { crm: false } — an HR hire is an employee record first,
//     NOT a CRM seat member; the admin grants modules explicitly from the
//     employee's System Permissions card (they keep HR "My Profile" access
//     via the role default);
//   • the agent-seat quota still applies — HR is not a side door around
//     plan limits.
async function resolveEmployeeUser(
  companyId: string,
  email: string,
  displayName: string,
): Promise<{ userId: string; createdLogin: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) throw new HRError("A valid email is required");

  const [existing] = await db
    .select({ id: users.id, companyId: users.companyId, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (existing) {
    if (existing.companyId !== companyId || existing.deletedAt) {
      throw new HRError("That email already belongs to another workspace");
    }
    return { userId: existing.id, createdLogin: false };
  }

  const quota = await checkAgentQuota(companyId);
  if (!quota.allowed) throw new HRError(quota.warning || "Agent limit reached for this plan.", 402);

  const passwordHash = await hashPassword(crypto.randomBytes(24).toString("hex"));
  const [created] = await db
    .insert(users)
    .values({
      companyId,
      name: displayName || normalized,
      email: normalized,
      passwordHash,
      role: "agent",
      tier: "1",
      active: true,
      mustChangePassword: true,
      moduleAccess: { crm: false },
    })
    .returning({ id: users.id });
  return { userId: created.id, createdLogin: true };
}

export async function getEmployee(companyId: string, id: string) {
  const rows = await employeeQuery(companyId, eq(hrEmployees.id, id));
  return rows[0] ?? null;
}
export async function getEmployeeByUser(companyId: string, userId: string) {
  const rows = await employeeQuery(companyId, eq(hrEmployees.userId, userId));
  return rows[0] ?? null;
}

// One shared select so every read returns the same enriched shape.
function employeeQuery(companyId: string, extra?: SQL) {
  return db
    .select({
      id: hrEmployees.id,
      userId: hrEmployees.userId,
      employeeCode: hrEmployees.employeeCode,
      firstName: hrEmployees.firstName,
      lastName: hrEmployees.lastName,
      preferredName: hrEmployees.preferredName,
      // Read-through from the login identity — single source, no duplication.
      email: users.email,
      phone: users.phone,
      loginName: users.name,
      role: users.role,
      dateOfBirth: hrEmployees.dateOfBirth,
      gender: hrEmployees.gender,
      joiningDate: hrEmployees.joiningDate,
      confirmationDate: hrEmployees.confirmationDate,
      employmentStatus: hrEmployees.employmentStatus,
      departmentId: hrEmployees.departmentId,
      departmentName: hrDepartments.name,
      designationId: hrEmployees.designationId,
      designationTitle: hrDesignations.title,
      employmentTypeId: hrEmployees.employmentTypeId,
      employmentTypeName: hrEmploymentTypes.name,
      managerUserId: hrEmployees.managerUserId,
      managerName: sql<string | null>`(select u.name from users u where u.id = ${hrEmployees.managerUserId})`,
      workLocation: hrEmployees.workLocation,
      monthlySalary: hrEmployees.monthlySalary,
      emergencyContact: hrEmployees.emergencyContact,
      profilePhotoUrl: hrEmployees.profilePhotoUrl,
      notes: hrEmployees.notes,
      createdAt: hrEmployees.createdAt,
    })
    .from(hrEmployees)
    .innerJoin(users, eq(users.id, hrEmployees.userId))
    .leftJoin(hrDepartments, eq(hrDepartments.id, hrEmployees.departmentId))
    .leftJoin(hrDesignations, eq(hrDesignations.id, hrEmployees.designationId))
    .leftJoin(hrEmploymentTypes, eq(hrEmploymentTypes.id, hrEmployees.employmentTypeId))
    .where(extra ? and(eq(hrEmployees.companyId, companyId), extra) : eq(hrEmployees.companyId, companyId))
    .orderBy(asc(hrEmployees.firstName));
}

export interface ListEmployeesOpts {
  search?: string;
  departmentId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listEmployees(companyId: string, opts: ListEmployeesOpts = {}) {
  const where: SQL[] = [eq(hrEmployees.companyId, companyId)];
  if (opts.departmentId) where.push(eq(hrEmployees.departmentId, opts.departmentId));
  if (opts.status) where.push(eq(hrEmployees.employmentStatus, opts.status));
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    const m = or(ilike(hrEmployees.firstName, q), ilike(hrEmployees.lastName, q), ilike(hrEmployees.employeeCode, q), ilike(users.email, q), ilike(users.name, q));
    if (m) where.push(m);
  }
  const rows = await db
    .select({
      id: hrEmployees.id,
      userId: hrEmployees.userId,
      employeeCode: hrEmployees.employeeCode,
      firstName: hrEmployees.firstName,
      lastName: hrEmployees.lastName,
      email: users.email,
      employmentStatus: hrEmployees.employmentStatus,
      departmentName: hrDepartments.name,
      designationTitle: hrDesignations.title,
      managerUserId: hrEmployees.managerUserId,
    })
    .from(hrEmployees)
    .innerJoin(users, eq(users.id, hrEmployees.userId))
    .leftJoin(hrDepartments, eq(hrDepartments.id, hrEmployees.departmentId))
    .leftJoin(hrDesignations, eq(hrDesignations.id, hrEmployees.designationId))
    .where(and(...where))
    .orderBy(asc(hrEmployees.firstName), asc(hrEmployees.lastName))
    .limit(Math.min(opts.limit ?? 50, 200))
    .offset(Math.max(opts.offset ?? 0, 0));
  return rows;
}

export interface CreateEmployeeInput {
  // Link to an existing member — or omit and provide `email` to add anyone.
  userId?: string;
  email?: string;
  employeeCode?: string;
  firstName: string;
  lastName?: string | null;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  joiningDate?: string | null;
  employmentStatus?: string;
  departmentId?: string | null;
  designationId?: string | null;
  employmentTypeId?: string | null;
  managerUserId?: string | null;
  workLocation?: string | null;
  // Enterprise Workspace: optional HR-side salary record (Payroll's salary
  // structures stay the payout source of truth).
  monthlySalary?: number | string | null;
  notes?: string | null;
}

// "" / null clears; anything else must be a non-negative number.
function normalizeSalary(v: number | string | null | undefined): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HRError("Salary must be a non-negative number");
  return n.toFixed(2);
}

async function validateRefs(companyId: string, input: { departmentId?: string | null; designationId?: string | null; employmentTypeId?: string | null; managerUserId?: string | null; dateOfBirth?: string | null; joiningDate?: string | null; employmentStatus?: string }) {
  if (input.employmentStatus && !EMPLOYMENT_STATUSES.includes(input.employmentStatus as EmploymentStatus)) throw new HRError("Invalid employment status");
  if (input.dateOfBirth && !isValidDateStr(input.dateOfBirth)) throw new HRError("Invalid date of birth");
  if (input.joiningDate && !isValidDateStr(input.joiningDate)) throw new HRError("Invalid joining date");
  if (input.departmentId) { const [d] = await db.select({ id: hrDepartments.id }).from(hrDepartments).where(and(eq(hrDepartments.id, input.departmentId), eq(hrDepartments.companyId, companyId))).limit(1); if (!d) throw new HRError("Department not found", 404); }
  if (input.designationId) { const [d] = await db.select({ id: hrDesignations.id }).from(hrDesignations).where(and(eq(hrDesignations.id, input.designationId), eq(hrDesignations.companyId, companyId))).limit(1); if (!d) throw new HRError("Designation not found", 404); }
  if (input.employmentTypeId) { const [d] = await db.select({ id: hrEmploymentTypes.id }).from(hrEmploymentTypes).where(and(eq(hrEmploymentTypes.id, input.employmentTypeId), eq(hrEmploymentTypes.companyId, companyId))).limit(1); if (!d) throw new HRError("Employment type not found", 404); }
  if (input.managerUserId) await assertCompanyUser(companyId, input.managerUserId);
}

export async function createEmployee(companyId: string, actorUserId: string, input: CreateEmployeeInput) {
  await ensureHRSetup(companyId);
  if (!input.firstName?.trim()) throw new HRError("First name is required");

  // Two doors, one record: an explicit userId links a known member; an email
  // links-or-creates (see resolveEmployeeUser). Exactly one is required.
  let userId: string;
  let createdLogin = false;
  if (input.userId) {
    await assertCompanyUser(companyId, input.userId);
    userId = input.userId;
  } else if (input.email?.trim()) {
    const resolved = await resolveEmployeeUser(
      companyId,
      input.email,
      [input.firstName.trim(), input.lastName?.trim()].filter(Boolean).join(" "),
    );
    userId = resolved.userId;
    createdLogin = resolved.createdLogin;
  } else {
    throw new HRError("An email is required");
  }

  if (input.managerUserId && input.managerUserId === userId) throw new HRError("An employee cannot report to themselves");
  await validateRefs(companyId, input);

  const settings = await getHRSettings(companyId);
  const employeeCode = input.employeeCode?.trim() || (await nextEmployeeCode(companyId));

  try {
    const [row] = await db
      .insert(hrEmployees)
      .values({
        companyId,
        userId,
        employeeCode,
        firstName: input.firstName.trim(),
        lastName: input.lastName?.trim() || null,
        preferredName: input.preferredName?.trim() || null,
        dateOfBirth: input.dateOfBirth || null,
        gender: input.gender || null,
        joiningDate: input.joiningDate || null,
        employmentStatus: input.employmentStatus || "active",
        departmentId: input.departmentId ?? null,
        designationId: input.designationId ?? null,
        employmentTypeId: input.employmentTypeId ?? settings.defaultEmploymentTypeId ?? null,
        managerUserId: input.managerUserId ?? null,
        workLocation: input.workLocation?.trim() || null,
        monthlySalary: normalizeSalary(input.monthlySalary),
        notes: input.notes?.trim() || null,
      })
      .returning();
    await recordAudit({ companyId, userId: actorUserId, action: "hr.employee_created", entityType: "hr_employee", entityId: row.id, after: { employeeCode: row.employeeCode, userId: row.userId, firstName: row.firstName }, metadata: { createdLogin } });
    return getEmployee(companyId, row.id);
  } catch (err) {
    if (isDup(err, "hr_employees_company_user_uniq")) throw new HRError("This user already has an HR profile");
    if (isDup(err, "hr_employees_company_code_uniq")) throw new HRError(`Employee code "${employeeCode}" is already in use`);
    throw err;
  }
}

export async function updateEmployee(companyId: string, actorUserId: string, id: string, patch: Partial<Omit<CreateEmployeeInput, "userId">> & { preferredName?: string | null; confirmationDate?: string | null; emergencyContact?: Record<string, unknown> | null; profilePhotoUrl?: string | null }) {
  const [existing] = await db.select().from(hrEmployees).where(and(eq(hrEmployees.id, id), eq(hrEmployees.companyId, companyId))).limit(1);
  if (!existing) throw new HRError("Employee not found", 404);
  if (patch.managerUserId && patch.managerUserId === existing.userId) throw new HRError("An employee cannot report to themselves");
  await validateRefs(companyId, patch);
  if (patch.confirmationDate && !isValidDateStr(patch.confirmationDate)) throw new HRError("Invalid confirmation date");
  // A manager change must not create a reporting loop (A→B→A).
  if (patch.managerUserId !== undefined) await assertNoCycle(companyId, existing.userId, patch.managerUserId ?? null);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  const map: [keyof typeof patch, string, boolean?][] = [
    ["firstName", "firstName", true], ["lastName", "lastName"], ["preferredName", "preferredName"],
    ["dateOfBirth", "dateOfBirth"], ["gender", "gender"], ["joiningDate", "joiningDate"], ["confirmationDate", "confirmationDate"],
    ["employmentStatus", "employmentStatus"], ["departmentId", "departmentId"], ["designationId", "designationId"],
    ["employmentTypeId", "employmentTypeId"], ["managerUserId", "managerUserId"], ["workLocation", "workLocation"],
    ["emergencyContact", "emergencyContact"], ["profilePhotoUrl", "profilePhotoUrl"], ["notes", "notes"],
  ];
  for (const [key, col, req] of map) {
    if (patch[key] !== undefined) {
      const v = patch[key];
      set[col] = typeof v === "string" ? (req ? v.trim() : v.trim() || null) : v;
    }
  }
  if (patch.monthlySalary !== undefined) set.monthlySalary = normalizeSalary(patch.monthlySalary);
  const [row] = await db.update(hrEmployees).set(set).where(eq(hrEmployees.id, id)).returning();
  const statusChanged = patch.employmentStatus !== undefined && patch.employmentStatus !== existing.employmentStatus;
  await recordAudit({
    companyId,
    userId: actorUserId,
    action: statusChanged ? "hr.employee_status_changed" : "hr.employee_updated",
    entityType: "hr_employee",
    entityId: id,
    before: { employmentStatus: existing.employmentStatus, departmentId: existing.departmentId, managerUserId: existing.managerUserId, monthlySalary: existing.monthlySalary },
    after: { employmentStatus: row.employmentStatus, departmentId: row.departmentId, managerUserId: row.managerUserId, monthlySalary: row.monthlySalary },
  });
  return getEmployee(companyId, id);
}

// An employee who manages others cannot be deleted (would orphan reports) —
// reassign their reports first. Documents cascade.
export async function deleteEmployee(companyId: string, actorUserId: string, id: string): Promise<void> {
  const [existing] = await db.select().from(hrEmployees).where(and(eq(hrEmployees.id, id), eq(hrEmployees.companyId, companyId))).limit(1);
  if (!existing) throw new HRError("Employee not found", 404);
  const [reports] = await db.select({ n: sql<number>`count(*)::int` }).from(hrEmployees).where(and(eq(hrEmployees.companyId, companyId), eq(hrEmployees.managerUserId, existing.userId)));
  if (reports.n > 0) throw new HRError("This employee manages others — reassign their direct reports first");
  await db.delete(hrEmployees).where(eq(hrEmployees.id, id));
  await recordAudit({ companyId, userId: actorUserId, action: "hr.employee_deleted", entityType: "hr_employee", entityId: id, before: { employeeCode: existing.employeeCode, firstName: existing.firstName } });
}

// Users in this company who do NOT yet have an HR profile (for the "add
// employee" picker).
export async function listUnprofiledUsers(companyId: string) {
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.active, true), isNull(users.deletedAt), sql`not exists (select 1 from hr_employees e where e.user_id = ${users.id})`))
    .orderBy(asc(users.name));
}
