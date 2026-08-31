// DocumentService — an employee's documents. A document is either an uploaded
// FILE (scanned ID, signed offer letter / agreement, a photo of a paper doc)
// whose bytes are stored in Postgres (hr_document_files, bytea) so uploads work
// with no external object storage, OR a metadata-only external `reference`
// (kept for back-compat). File bytes live in their own table so listing an
// employee's documents never loads them.
import { db } from "@/db";
import { hrDocuments, hrDocumentFiles, hrEmployees } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { DOCUMENT_TYPES, HRError, type DocumentType } from "./types";

// Uploads: images + PDF, up to 10 MB each (kept modest — this is HR paperwork,
// not a media store). Enforced SERVER-SIDE regardless of the client.
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOC_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

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

// Upload a real file (bytes stored in hr_document_files). The metadata row and
// the blob are written together so a document row never dangles without bytes.
export async function addDocumentFile(
  companyId: string,
  actorUserId: string,
  input: { employeeId: string; type: string; title: string; notes?: string | null; fileName: string; mimeType: string; bytes: Buffer },
) {
  const [emp] = await db.select({ id: hrEmployees.id }).from(hrEmployees).where(and(eq(hrEmployees.id, input.employeeId), eq(hrEmployees.companyId, companyId))).limit(1);
  if (!emp) throw new HRError("Employee not found", 404);
  if (!DOCUMENT_TYPES.includes(input.type as DocumentType)) throw new HRError("Invalid document type");
  if (!input.title?.trim()) throw new HRError("A document title is required");
  if (!ALLOWED_DOC_MIME[input.mimeType]) throw new HRError("Only PDF, PNG, JPG or WebP files can be uploaded");
  if (!input.bytes || input.bytes.length === 0) throw new HRError("The file is empty");
  if (input.bytes.length > MAX_DOC_BYTES) throw new HRError("File is too large — the limit is 10 MB");

  const row = await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(hrDocuments)
      .values({
        companyId,
        employeeId: input.employeeId,
        type: input.type,
        title: input.title.trim().slice(0, 160),
        fileName: input.fileName.slice(0, 255),
        mimeType: input.mimeType,
        fileSize: input.bytes.length,
        notes: input.notes?.trim() || null,
        uploadedBy: actorUserId,
      })
      .returning();
    await tx.insert(hrDocumentFiles).values({ companyId, documentId: doc.id, data: input.bytes });
    return doc;
  });
  await recordAudit({ companyId, userId: actorUserId, action: "hr.document_added", entityType: "hr_document", entityId: row.id, after: { employeeId: input.employeeId, type: row.type, title: row.title, fileName: row.fileName } });
  return row;
}

// The bytes + metadata for a stored file (company-scoped), for download/preview.
export async function getDocumentFile(companyId: string, documentId: string): Promise<{ fileName: string; mimeType: string; data: Buffer } | null> {
  const [row] = await db
    .select({ fileName: hrDocuments.fileName, mimeType: hrDocuments.mimeType, data: hrDocumentFiles.data })
    .from(hrDocumentFiles)
    .innerJoin(hrDocuments, eq(hrDocuments.id, hrDocumentFiles.documentId))
    .where(and(eq(hrDocumentFiles.documentId, documentId), eq(hrDocumentFiles.companyId, companyId)))
    .limit(1);
  if (!row?.data) return null;
  return { fileName: row.fileName || "document", mimeType: row.mimeType || "application/octet-stream", data: row.data as Buffer };
}

export async function deleteDocument(companyId: string, actorUserId: string, id: string): Promise<void> {
  const [row] = await db.select().from(hrDocuments).where(and(eq(hrDocuments.id, id), eq(hrDocuments.companyId, companyId))).limit(1);
  if (!row) throw new HRError("Document not found", 404);
  await db.delete(hrDocuments).where(eq(hrDocuments.id, id));
  await recordAudit({ companyId, userId: actorUserId, action: "hr.document_deleted", entityType: "hr_document", entityId: id, before: { title: row.title, type: row.type } });
}
