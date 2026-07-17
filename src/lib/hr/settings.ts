// Phase 22 — HR settings + idempotent per-company bootstrap (employment types
// + the settings row) + employee-code generation.
import { db } from "@/db";
import { hrEmploymentTypes, hrSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { HRError } from "./types";

const SYSTEM_TYPES = [
  { name: "Permanent", code: "PERMANENT" },
  { name: "Contract", code: "CONTRACT" },
  { name: "Intern", code: "INTERN" },
  { name: "Part-time", code: "PART_TIME" },
  { name: "Temporary", code: "TEMPORARY" },
];

export async function ensureHRSetup(companyId: string): Promise<boolean> {
  const inserted = await db
    .insert(hrEmploymentTypes)
    .values(SYSTEM_TYPES.map((t) => ({ companyId, name: t.name, code: t.code, isSystem: true })))
    .onConflictDoNothing()
    .returning({ id: hrEmploymentTypes.id, code: hrEmploymentTypes.code });
  const permanent = inserted.find((t) => t.code === "PERMANENT");
  await db.insert(hrSettings).values({ companyId, defaultEmploymentTypeId: permanent?.id ?? null }).onConflictDoNothing();
  return inserted.length === SYSTEM_TYPES.length;
}

export async function getHRSettings(companyId: string) {
  await ensureHRSetup(companyId);
  const [row] = await db.select().from(hrSettings).where(eq(hrSettings.companyId, companyId)).limit(1);
  return row!;
}

export async function updateHRSettings(companyId: string, patch: { employeeCodePrefix?: string; defaultEmploymentTypeId?: string | null }) {
  await ensureHRSetup(companyId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.employeeCodePrefix !== undefined) {
    const p = patch.employeeCodePrefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(p)) throw new HRError("Code prefix must be 1-12 letters/digits");
    set.employeeCodePrefix = p;
  }
  if (patch.defaultEmploymentTypeId !== undefined) set.defaultEmploymentTypeId = patch.defaultEmploymentTypeId || null;
  const [row] = await db.update(hrSettings).set(set).where(eq(hrSettings.companyId, companyId)).returning();
  return row;
}

// Sequential employee code (PREFIX-000001), atomic per company.
export async function nextEmployeeCode(companyId: string): Promise<string> {
  const rows = await db
    .update(hrSettings)
    .set({ nextEmployeeNumber: sql`${hrSettings.nextEmployeeNumber} + 1`, updatedAt: new Date() })
    .where(eq(hrSettings.companyId, companyId))
    .returning({ n: hrSettings.nextEmployeeNumber, prefix: hrSettings.employeeCodePrefix });
  if (rows.length === 0) {
    await ensureHRSetup(companyId);
    return nextEmployeeCode(companyId);
  }
  const num = rows[0].n - 1;
  return `${rows[0].prefix}-${String(num).padStart(6, "0")}`;
}
