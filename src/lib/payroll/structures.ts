// Phase 21 — SalaryStructureService. Structures are VERSIONED: creating a
// structure makes v1; editing it makes v2 (chained to v1 via rootId, v1
// deactivated) and so on. Profiles reference a specific version row, and a run
// snapshots the numbers, so the history is never rewritten.
import { db } from "@/db";
import { payrollProfiles, payrollStructures } from "@/db/schema";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { COMPONENT_TYPES, PAY_FREQUENCIES, PayrollError, type ComponentType, type PayFrequency, type StructureComponent } from "./types";

function validateComponents(raw: unknown): StructureComponent[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new PayrollError("Components must be a list");
  return raw.map((c, i) => {
    const o = c as Partial<StructureComponent>;
    if (!o.label || typeof o.label !== "string") throw new PayrollError(`Component ${i + 1} needs a label`);
    if (!o.type || !COMPONENT_TYPES.includes(o.type as ComponentType)) throw new PayrollError(`Component "${o.label}" has an invalid type`);
    const amountCents = Math.round(Number(o.amountCents ?? 0));
    if (!Number.isFinite(amountCents) || amountCents < 0) throw new PayrollError(`Component "${o.label}" needs a non-negative amount`);
    return {
      key: (o.key && typeof o.key === "string" ? o.key : `c${i + 1}`).slice(0, 40),
      label: o.label.slice(0, 60),
      type: o.type as ComponentType,
      amountCents,
      taxable: o.taxable === true,
    };
  });
}

export interface StructureInput {
  name: string;
  frequency: string;
  basicCents: number;
  components?: unknown;
}

function validateInput(input: StructureInput) {
  if (!input.name?.trim()) throw new PayrollError("Structure name is required");
  if (!PAY_FREQUENCIES.includes(input.frequency as PayFrequency)) throw new PayrollError("Invalid pay frequency");
  const basic = Math.round(Number(input.basicCents ?? 0));
  if (!Number.isFinite(basic) || basic < 0) throw new PayrollError("Basic salary must be a non-negative amount");
  return { basic, components: validateComponents(input.components) };
}

export async function createStructure(companyId: string, actorUserId: string, input: StructureInput) {
  const { basic, components } = validateInput(input);
  const [row] = await db
    .insert(payrollStructures)
    .values({ companyId, name: input.name.trim(), frequency: input.frequency, basicCents: basic, components, version: 1, active: true, createdBy: actorUserId })
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "payroll.structure_created", entityType: "payroll_structure", entityId: row.id, after: { name: row.name, frequency: row.frequency, basicCents: basic, version: 1 } });
  return row;
}

// Editing = new version. The lineage root is the current row's root (or itself
// for v1). The superseded row is deactivated; profiles that pointed at it are
// repointed to the new version so employees stay on the current structure.
export async function reviseStructure(companyId: string, actorUserId: string, structureId: string, input: StructureInput) {
  const current = await getStructure(companyId, structureId);
  if (!current) throw new PayrollError("Structure not found", 404);
  const { basic, components } = validateInput(input);
  const rootId = current.rootId ?? current.id;

  const revised = await db.transaction(async (tx) => {
    await tx.update(payrollStructures).set({ active: false, updatedAt: new Date() }).where(eq(payrollStructures.id, current.id));
    const [row] = await tx
      .insert(payrollStructures)
      .values({ companyId, rootId, version: current.version + 1, active: true, name: input.name.trim(), frequency: input.frequency, basicCents: basic, components, createdBy: actorUserId })
      .returning();
    // Repoint every profile on the old version to the new one.
    await tx.update(payrollProfiles).set({ structureId: row.id, updatedAt: new Date() }).where(and(eq(payrollProfiles.companyId, companyId), eq(payrollProfiles.structureId, current.id)));
    return row;
  });
  await recordAudit({ companyId, userId: actorUserId, action: "payroll.structure_revised", entityType: "payroll_structure", entityId: revised.id, before: { basicCents: current.basicCents, version: current.version }, after: { basicCents: basic, version: revised.version } });
  return revised;
}

export async function getStructure(companyId: string, structureId: string) {
  const [row] = await db.select().from(payrollStructures).where(and(eq(payrollStructures.id, structureId), eq(payrollStructures.companyId, companyId))).limit(1);
  return row ?? null;
}

// Active (current) structures only — one row per lineage.
export async function listStructures(companyId: string) {
  return db.select().from(payrollStructures).where(and(eq(payrollStructures.companyId, companyId), eq(payrollStructures.active, true))).orderBy(asc(payrollStructures.name));
}

// Full version history of one lineage (newest first).
export async function structureHistory(companyId: string, structureId: string) {
  const s = await getStructure(companyId, structureId);
  if (!s) throw new PayrollError("Structure not found", 404);
  const root = s.rootId ?? s.id;
  return db
    .select()
    .from(payrollStructures)
    .where(and(eq(payrollStructures.companyId, companyId), or(eq(payrollStructures.id, root), eq(payrollStructures.rootId, root))))
    .orderBy(desc(payrollStructures.version));
}
