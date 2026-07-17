// Phase 22 — DocumentService. ARCHITECTURE ONLY: metadata rows for an
// employee's documents (offer letter, contract, ID, certificate, other). No
// file storage, no OCR, no e-signatures — `reference` is a placeholder for a
// future external URL/handle.
import { db } from "@/db";
import { hrDocuments, hrEmployees } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { DOCUMENT_TYPES, HRError, type DocumentType } from "./types";

export async function listDocuments(companyId: string, employeeId: string) {
  return db
    .select()
    .from(hrDocuments)
    .where(and(eq(hrDocuments.companyId, companyId), eq(hrDocuments.employeeId, employeeId)))
    .orderBy(desc(hrDocuments.createdAt));
}

export async function addDocument(companyId: string, actorUserId: string, input: { employeeId: string; type: string; title: string; reference?: string | null; notes?: string | null }) {
  const [emp] = await db.select({ id: hrEmployees.id }).from(hrEmployees).where(and(eq(hrEmployees.id, input.employeeId), eq(hrEmployees.companyId, companyId))).limit(1);
  if (!emp) throw new HRError("Employee not found", 404);
  if (!DOCUMENT_TYPES.includes(input.type as DocumentType)) throw new HRError("Invalid document type");
  if (!input.title?.trim()) throw new HRError("A document title is required");
  const [row] = await db
    .insert(hrDocuments)
    .values({ companyId, employeeId: input.employeeId, type: input.type, title: input.title.trim(), reference: input.reference?.trim() || null, notes: input.notes?.trim() || null, uploadedBy: actorUserId })
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "hr.document_added", entityType: "hr_document", entityId: row.id, after: { employeeId: input.employeeId, type: row.type, title: row.title } });
  return row;
}

export async function deleteDocument(companyId: string, actorUserId: string, id: string): Promise<void> {
  const [row] = await db.select().from(hrDocuments).where(and(eq(hrDocuments.id, id), eq(hrDocuments.companyId, companyId))).limit(1);
  if (!row) throw new HRError("Document not found", 404);
  await db.delete(hrDocuments).where(eq(hrDocuments.id, id));
  await recordAudit({ companyId, userId: actorUserId, action: "hr.document_deleted", entityType: "hr_document", entityId: id, before: { title: row.title, type: row.type } });
}
