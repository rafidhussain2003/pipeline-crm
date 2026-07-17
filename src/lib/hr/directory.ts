// Phase 22 — the INTEGRATION SEAM. HR is the master employee directory; other
// modules (Attendance, Payroll, CRM, future HR modules) resolve an employee by
// the shared userId and get the authoritative HR data — instead of storing
// their own copy. These are the read-only functions those modules consume.
//
// Because every module already keys on userId, "reference HR employees" needs
// no schema change downstream: it's this lookup layered over the same identity.
import { db } from "@/db";
import { hrDepartments, hrDesignations, hrEmployees, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export interface DirectoryEntry {
  userId: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  email: string;
  department: string | null;
  designation: string | null;
  managerUserId: string | null;
  employmentStatus: string;
}

function toEntry(r: {
  userId: string; employeeId: string; employeeCode: string; firstName: string; lastName: string | null;
  loginName: string | null; email: string; department: string | null; designation: string | null;
  managerUserId: string | null; employmentStatus: string;
}): DirectoryEntry {
  return {
    userId: r.userId,
    employeeId: r.employeeId,
    employeeCode: r.employeeCode,
    fullName: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.loginName || r.email,
    email: r.email,
    department: r.department,
    designation: r.designation,
    managerUserId: r.managerUserId,
    employmentStatus: r.employmentStatus,
  };
}

const base = () =>
  db
    .select({
      userId: hrEmployees.userId,
      employeeId: hrEmployees.id,
      employeeCode: hrEmployees.employeeCode,
      firstName: hrEmployees.firstName,
      lastName: hrEmployees.lastName,
      loginName: users.name,
      email: users.email,
      department: hrDepartments.name,
      designation: hrDesignations.title,
      managerUserId: hrEmployees.managerUserId,
      employmentStatus: hrEmployees.employmentStatus,
    })
    .from(hrEmployees)
    .innerJoin(users, eq(users.id, hrEmployees.userId))
    .leftJoin(hrDepartments, eq(hrDepartments.id, hrEmployees.departmentId))
    .leftJoin(hrDesignations, eq(hrDesignations.id, hrEmployees.designationId));

// Resolve one employee by their user identity (what Attendance/Payroll hold).
export async function resolveEmployee(companyId: string, userId: string): Promise<DirectoryEntry | null> {
  const [r] = await base().where(and(eq(hrEmployees.companyId, companyId), eq(hrEmployees.userId, userId))).limit(1);
  return r ? toEntry(r) : null;
}

// The whole company directory keyed by userId — the canonical map other
// modules enrich against.
export async function getEmployeeDirectory(companyId: string): Promise<Map<string, DirectoryEntry>> {
  const rows = await base().where(eq(hrEmployees.companyId, companyId));
  return new Map(rows.map((r) => [r.userId, toEntry(r)]));
}

// Bulk resolve a set of user ids (e.g. a payroll run's employees).
export async function resolveEmployees(companyId: string, userIds: string[]): Promise<Map<string, DirectoryEntry>> {
  if (userIds.length === 0) return new Map();
  const rows = await base().where(and(eq(hrEmployees.companyId, companyId), inArray(hrEmployees.userId, userIds)));
  return new Map(rows.map((r) => [r.userId, toEntry(r)]));
}
