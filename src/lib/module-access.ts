// Enterprise Workspaces — per-user module access.
//
// Replaces fixed role→department access with an explicit grant system: an
// admin can assign exactly which modules (workspaces) each employee can
// open. Three-layer resolution, checked in this order everywhere:
//
//   1. Company entitlement  — the Platform Owner's feature switch (featureService)
//   2. Per-user assignment  — users.module_access jsonb, written only here
//   3. Role default         — exactly the pre-existing behavior, used when a
//                             user has no explicit assignment (NULL column)
//
// A user with module_access = NULL behaves precisely as before this system
// existed — the rollout changes nothing until an admin assigns access.
//
// This module owns the vocabulary and the storage; each module's own guard
// (requireFinance / requireHR / …) consults resolveModuleOverride() for the
// deny/grant decision and keeps its internal CAPABILITY model (hr:manage,
// finance:manage, …) role-based — a module grant opens the door, it never
// hands out admin powers inside the room.
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { recordAudit } from "@/lib/audit";
import { isSchemaLagError } from "@/lib/db-errors";
import type { Role } from "@/lib/permissions";

// The assignable modules. Future modules (Recruitment, Reports, …) = one row
// here + a guard consulting resolveModuleOverride, nothing else.
export const MODULES = [
  { key: "crm", label: "CRM", description: "Leads, pipeline, callbacks, tasks — the core product." },
  { key: "hr", label: "HR", description: "Employee directory, departments, org chart, documents." },
  { key: "finance", label: "Finance", description: "Books, transactions, investments, receipts." },
  { key: "attendance", label: "Attendance", description: "Check-in/out, shifts, leave, holidays." },
  { key: "payroll", label: "Payroll", description: "Salary structures, payroll runs, payslips." },
  { key: "workflow", label: "Workflow Automation", description: "Triggers, conditions, automated actions." },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

export function isModuleKey(key: string): key is ModuleKey {
  return (MODULE_KEYS as string[]).includes(key);
}

// Role defaults — a faithful transcription of the access each role had
// BEFORE per-user assignment existed (see each module's permissions.ts).
const ROLE_DEFAULTS: Record<Role, Record<ModuleKey, boolean>> = {
  super_admin: { crm: true, hr: false, finance: false, attendance: false, payroll: false, workflow: false },
  admin: { crm: true, hr: true, finance: true, attendance: true, payroll: true, workflow: true },
  manager: { crm: true, hr: true, finance: true, attendance: true, payroll: true, workflow: true },
  agent: { crm: true, hr: true, finance: false, attendance: true, payroll: true, workflow: false },
};

export type ModuleAccessMap = Record<ModuleKey, boolean>;

const TTL = 30_000;
const cacheKey = (userId: string) => `module-access:${userId}`;

// The stored assignment (or null when the user has never been assigned).
async function storedAccess(userId: string): Promise<Record<string, boolean> | null> {
  try {
    return await cache.getOrSet(cacheKey(userId), TTL, async () => {
      const [row] = await db.select({ m: users.moduleAccess }).from(users).where(eq(users.id, userId)).limit(1);
      const raw = row?.m;
      if (!raw || typeof raw !== "object") return null;
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "boolean" && isModuleKey(k)) out[k] = v;
      }
      return Object.keys(out).length > 0 ? out : null;
    });
  } catch (err) {
    // Migration lag (users.module_access ships in 0040): a missing column
    // must behave exactly like "no assignment yet" — role defaults — not
    // 500 every guarded page for every non-admin. Loud log, self-heals the
    // moment the boot migrator lands the column.
    if (!isSchemaLagError(err)) throw err;
    console.error("[module-access] module_access column missing — migration 0040 not applied yet; using role defaults");
    return null;
  }
}

// The user's effective access map (assignment overlaid on role defaults).
// Admins always keep every module: an assignment must never lock the person
// who does the assigning out of their own controls.
export async function getEffectiveModuleAccess(userId: string, role: Role): Promise<ModuleAccessMap> {
  const defaults = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.agent;
  const map: ModuleAccessMap = { ...defaults };
  if (role === "admin" || role === "super_admin") return map;
  const stored = await storedAccess(userId);
  if (stored) for (const key of MODULE_KEYS) if (key in stored) map[key] = stored[key];
  return map;
}

// The guard hook: "denied" (explicitly blocked), "granted" (explicitly
// allowed — possibly beyond the role default), or "default" (no assignment;
// the module's pre-existing role logic decides).
export async function resolveModuleOverride(userId: string, role: Role, key: ModuleKey): Promise<"denied" | "granted" | "default"> {
  if (role === "admin" || role === "super_admin") return "default"; // admins are never overridden
  const stored = await storedAccess(userId);
  if (!stored || !(key in stored)) return "default";
  return stored[key] ? "granted" : "denied";
}

export async function canAccessModule(userId: string, role: Role, key: ModuleKey): Promise<boolean> {
  return (await getEffectiveModuleAccess(userId, role))[key];
}

// The ONE write path — validated, audited (before/after), cache-invalidated.
// Admin-only enforcement lives at the route; targets may be managers/agents
// of the SAME company only (checked here so no caller can forget it).
export async function setModuleAccess(
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  assignment: Record<string, boolean>,
): Promise<ModuleAccessMap> {
  const clean: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(assignment)) {
    if (typeof v === "boolean" && isModuleKey(k)) clean[k] = v;
  }

  const [target] = await db
    .select({ id: users.id, companyId: users.companyId, role: users.role, moduleAccess: users.moduleAccess })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target || target.companyId !== companyId) throw new Error("User not found in this company.");
  if (target.role === "admin") throw new Error("Admins always have every module — their access can't be assigned.");

  const before = await getEffectiveModuleAccess(target.id, target.role as Role);
  await db.update(users).set({ moduleAccess: clean }).where(eq(users.id, targetUserId));
  await cache.delete(cacheKey(targetUserId));
  const after = await getEffectiveModuleAccess(target.id, target.role as Role);

  await recordAudit({
    companyId,
    userId: actorUserId,
    action: "user.module_access_updated",
    entityType: "user",
    entityId: targetUserId,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
  });
  return after;
}
