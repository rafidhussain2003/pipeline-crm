// Phase 22 — OrganizationService: the reporting hierarchy (manager → direct
// reports, arbitrarily deep). Built from hr_employees.managerUserId, which
// references the shared user identity.
import { db } from "@/db";
import { hrDesignations, hrEmployees, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { HRError } from "./types";

export interface OrgNode {
  employeeId: string;
  userId: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  managerUserId: string | null;
  reports: OrgNode[];
}

// The whole company tree (roots = employees with no manager, or whose manager
// isn't an employee). Cycle-safe: each node is emitted at most once.
export async function getOrgChart(companyId: string): Promise<OrgNode[]> {
  const rows = await db
    .select({
      employeeId: hrEmployees.id,
      userId: hrEmployees.userId,
      name: users.name,
      firstName: hrEmployees.firstName,
      lastName: hrEmployees.lastName,
      employeeCode: hrEmployees.employeeCode,
      designation: hrDesignations.title,
      managerUserId: hrEmployees.managerUserId,
    })
    .from(hrEmployees)
    .innerJoin(users, eq(users.id, hrEmployees.userId))
    .leftJoin(hrDesignations, eq(hrDesignations.id, hrEmployees.designationId))
    .where(eq(hrEmployees.companyId, companyId));

  const byUser = new Map<string, OrgNode>();
  for (const r of rows) {
    byUser.set(r.userId, {
      employeeId: r.employeeId,
      userId: r.userId,
      name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.name,
      employeeCode: r.employeeCode,
      designation: r.designation,
      managerUserId: r.managerUserId,
      reports: [],
    });
  }
  const roots: OrgNode[] = [];
  const placed = new Set<string>();
  for (const node of byUser.values()) {
    const mgr = node.managerUserId ? byUser.get(node.managerUserId) : undefined;
    if (mgr && mgr.userId !== node.userId && !createsCycle(node.userId, node.managerUserId, byUser)) {
      mgr.reports.push(node);
    } else {
      roots.push(node);
    }
    placed.add(node.userId);
  }
  return roots;
}

// Would making `userId` report to `managerUserId` create a loop? Walk up the
// manager chain from the proposed manager; if we reach userId, it's a cycle.
function createsCycle(userId: string, managerUserId: string | null, byUser: Map<string, OrgNode>): boolean {
  let cur = managerUserId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === userId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byUser.get(cur)?.managerUserId ?? null;
  }
  return false;
}

// The direct reports of one employee (by user id).
export async function getDirectReports(companyId: string, managerUserId: string) {
  return db
    .select({ employeeId: hrEmployees.id, userId: hrEmployees.userId, name: users.name, employeeCode: hrEmployees.employeeCode, designation: hrDesignations.title })
    .from(hrEmployees)
    .innerJoin(users, eq(users.id, hrEmployees.userId))
    .leftJoin(hrDesignations, eq(hrDesignations.id, hrEmployees.designationId))
    .where(and(eq(hrEmployees.companyId, companyId), eq(hrEmployees.managerUserId, managerUserId)));
}

// Guard used by the employee service on manager assignment: reject a change
// that would create a reporting cycle.
export async function assertNoCycle(companyId: string, employeeUserId: string, newManagerUserId: string | null): Promise<void> {
  if (!newManagerUserId) return;
  const rows = await db.select({ userId: hrEmployees.userId, managerUserId: hrEmployees.managerUserId }).from(hrEmployees).where(eq(hrEmployees.companyId, companyId));
  const mgrOf = new Map(rows.map((r) => [r.userId, r.managerUserId]));
  let cur: string | null = newManagerUserId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === employeeUserId) throw new HRError("That reporting line would create a cycle");
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = mgrOf.get(cur) ?? null;
  }
}
