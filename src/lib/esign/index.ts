// E-Sign — service layer. Admin side: upload → signers → fields → send →
// track/void. Signer side (no account; the link's token is the credential):
// view → adopt signature → fill fields → finish, or decline. When the last
// signer finishes, the signed PDF is generated (fields burned in + a
// certificate of completion page) and everyone is emailed.
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { esignDocuments, esignEvents, esignFields, esignFiles, esignSigners, users } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireCompanySession, type CompanySession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getPublicAppUrl } from "@/lib/url";
import { PDFDocument } from "pdf-lib";
import { buildSignedPdf } from "./signed-pdf";
import { sendCompletedEmail, sendDeclinedEmail, sendSigningRequestEmail } from "./email";

export class EsignError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
export function esignErrorResponse(err: unknown): NextResponse {
  if (err instanceof EsignError) return NextResponse.json({ error: err.message }, { status: err.status });
  throw err;
}

// Admin only, and independent of every module/feature flag.
export async function requireEsignAdmin(): Promise<{ ok: true; session: CompanySession } | { ok: false; response: NextResponse }> {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth;
  if (auth.session.role !== "admin") return { ok: false, response: NextResponse.json({ error: "Docusign is available to the company admin only." }, { status: 403 }) };
  return auth;
}

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const FIELD_TYPES = ["signature", "initials", "date", "text", "checkbox"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
const SIGNER_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#4b5563"];

export function signingUrl(token: string): string {
  return `${getPublicAppUrl()}/sign/${token}`;
}

async function logEvent(companyId: string, documentId: string, kind: string, opts: { signerId?: string | null; detail?: string | null; ip?: string | null; userAgent?: string | null } = {}) {
  await db.insert(esignEvents).values({ companyId, documentId, signerId: opts.signerId ?? null, kind, detail: opts.detail ?? null, ipAddress: opts.ip?.slice(0, 64) ?? null, userAgent: opts.userAgent?.slice(0, 300) ?? null });
}

// ── Admin: documents ────────────────────────────────────────────────────────
export async function listDocuments(companyId: string) {
  const docs = await db.select().from(esignDocuments).where(eq(esignDocuments.companyId, companyId)).orderBy(desc(esignDocuments.createdAt));
  const signers = await db
    .select({ documentId: esignSigners.documentId, name: esignSigners.name, email: esignSigners.email, status: esignSigners.status })
    .from(esignSigners)
    .where(eq(esignSigners.companyId, companyId))
    .orderBy(asc(esignSigners.position));
  const byDoc = new Map<string, typeof signers>();
  for (const s of signers) byDoc.set(s.documentId, [...(byDoc.get(s.documentId) ?? []), s]);
  return docs.map((d) => ({ ...d, signers: byDoc.get(d.id) ?? [] }));
}

export async function createDocument(companyId: string, userId: string, input: { title: string; fileName: string; bytes: Buffer }) {
  const title = input.title.trim().slice(0, 200) || input.fileName.replace(/\.pdf$/i, "").slice(0, 200) || "Untitled document";
  if (input.bytes.length === 0) throw new EsignError("The file is empty");
  if (input.bytes.length > MAX_PDF_BYTES) throw new EsignError("PDF must be 15 MB or smaller");
  if (input.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new EsignError("Only PDF files can be sent for signature");
  let pageCount = 1;
  try {
    pageCount = (await PDFDocument.load(input.bytes, { ignoreEncryption: true })).getPageCount();
  } catch {
    throw new EsignError("This PDF could not be read. Try re-saving it or exporting it again.");
  }
  const doc = await db.transaction(async (tx) => {
    const [row] = await tx.insert(esignDocuments).values({ companyId, title, fileName: input.fileName.slice(0, 255), fileSize: input.bytes.length, pageCount, createdBy: userId }).returning();
    await tx.insert(esignFiles).values({ companyId, documentId: row.id, kind: "original", data: input.bytes });
    return row;
  });
  await logEvent(companyId, doc.id, "created", { detail: `${input.fileName} (${pageCount} page${pageCount === 1 ? "" : "s"})` });
  await recordAudit({ companyId, userId, action: "esign.document_created", entityType: "esign_document", entityId: doc.id, after: { title, pageCount, fileSize: input.bytes.length } });
  return doc;
}

export async function getDocument(companyId: string, id: string) {
  const [doc] = await db.select().from(esignDocuments).where(and(eq(esignDocuments.id, id), eq(esignDocuments.companyId, companyId))).limit(1);
  if (!doc) return null;
  const [signers, fields, events] = await Promise.all([
    db.select().from(esignSigners).where(eq(esignSigners.documentId, id)).orderBy(asc(esignSigners.position)),
    db.select().from(esignFields).where(eq(esignFields.documentId, id)).orderBy(asc(esignFields.page), asc(esignFields.createdAt)),
    db.select().from(esignEvents).where(eq(esignEvents.documentId, id)).orderBy(asc(esignEvents.createdAt)),
  ]);
  const hasSigned = await db.select({ id: esignFiles.id }).from(esignFiles).where(and(eq(esignFiles.documentId, id), eq(esignFiles.kind, "signed"))).limit(1);
  return {
    doc,
    // The token is the signer's secret; the admin sees the link (to copy) but it never leaves this company's session.
    signers: signers.map((s) => ({ ...s, signatureData: undefined, initialsData: undefined, link: signingUrl(s.token), hasSignature: !!s.signatureData })),
    fields,
    events,
    hasSignedFile: hasSigned.length > 0,
  };
}

export async function getFile(companyId: string, documentId: string, kind: "original" | "signed") {
  const [f] = await db.select({ data: esignFiles.data }).from(esignFiles).where(and(eq(esignFiles.companyId, companyId), eq(esignFiles.documentId, documentId), eq(esignFiles.kind, kind))).limit(1);
  return f?.data ?? null;
}

export async function updateDocument(companyId: string, userId: string, id: string, patch: { title?: string; message?: string | null }) {
  const [doc] = await db.select().from(esignDocuments).where(and(eq(esignDocuments.id, id), eq(esignDocuments.companyId, companyId))).limit(1);
  if (!doc) throw new EsignError("Document not found", 404);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) { const t = patch.title.trim().slice(0, 200); if (!t) throw new EsignError("Title is required"); set.title = t; }
  if (patch.message !== undefined) set.message = patch.message?.trim().slice(0, 2000) || null;
  const [row] = await db.update(esignDocuments).set(set).where(eq(esignDocuments.id, id)).returning();
  return row;
}

export async function deleteDocument(companyId: string, userId: string, id: string) {
  const [doc] = await db.select().from(esignDocuments).where(and(eq(esignDocuments.id, id), eq(esignDocuments.companyId, companyId))).limit(1);
  if (!doc) throw new EsignError("Document not found", 404);
  if (doc.status !== "draft") throw new EsignError("Only a draft can be deleted. Void a sent document instead.");
  await db.delete(esignDocuments).where(eq(esignDocuments.id, id));
  await recordAudit({ companyId, userId, action: "esign.document_deleted", entityType: "esign_document", entityId: id, before: { title: doc.title } });
}

// ── Admin: signers & fields (draft only) ────────────────────────────────────
async function requireDraft(companyId: string, id: string) {
  const [doc] = await db.select().from(esignDocuments).where(and(eq(esignDocuments.id, id), eq(esignDocuments.companyId, companyId))).limit(1);
  if (!doc) throw new EsignError("Document not found", 404);
  if (doc.status !== "draft") throw new EsignError("This document has already been sent and can't be edited. Void it and upload again to make changes.");
  return doc;
}

export async function setSigners(companyId: string, userId: string, documentId: string, input: { id?: string; name: string; email: string }[]) {
  await requireDraft(companyId, documentId);
  if (!Array.isArray(input) || input.length === 0) throw new EsignError("Add at least one signer");
  if (input.length > 20) throw new EsignError("At most 20 signers");
  const seen = new Set<string>();
  const cleaned = input.map((s, i) => {
    const name = String(s.name ?? "").trim().slice(0, 160);
    const email = String(s.email ?? "").trim().toLowerCase().slice(0, 200);
    if (!name) throw new EsignError(`Signer ${i + 1} needs a name`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EsignError(`Signer ${i + 1} needs a valid email`);
    if (seen.has(email)) throw new EsignError(`${email} is listed twice`);
    seen.add(email);
    return { id: typeof s.id === "string" ? s.id : null, name, email, position: i };
  });
  const existing = await db.select().from(esignSigners).where(eq(esignSigners.documentId, documentId));
  const keep = new Set(cleaned.map((c) => c.id).filter(Boolean) as string[]);
  await db.transaction(async (tx) => {
    for (const e of existing) if (!keep.has(e.id)) await tx.delete(esignSigners).where(eq(esignSigners.id, e.id)); // fields cascade
    for (const c of cleaned) {
      const color = SIGNER_COLORS[c.position % SIGNER_COLORS.length];
      if (c.id && keep.has(c.id) && existing.some((e) => e.id === c.id)) {
        await tx.update(esignSigners).set({ name: c.name, email: c.email, position: c.position, color }).where(eq(esignSigners.id, c.id));
      } else {
        await tx.insert(esignSigners).values({ companyId, documentId, name: c.name, email: c.email, position: c.position, color, token: randomBytes(32).toString("hex") });
      }
    }
  });
  return db.select().from(esignSigners).where(eq(esignSigners.documentId, documentId)).orderBy(asc(esignSigners.position));
}

export type FieldInput = { id?: string; signerId: string; type: FieldType; page: number; x: number; y: number; w: number; h: number; required?: boolean; label?: string | null };

export async function setFields(companyId: string, userId: string, documentId: string, input: FieldInput[]) {
  const doc = await requireDraft(companyId, documentId);
  if (!Array.isArray(input)) throw new EsignError("Fields must be a list");
  if (input.length > 500) throw new EsignError("At most 500 fields");
  const signers = await db.select({ id: esignSigners.id }).from(esignSigners).where(eq(esignSigners.documentId, documentId));
  const signerIds = new Set(signers.map((s) => s.id));
  const clamp = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(n)));
  const rows = input.map((f, i) => {
    if (!signerIds.has(String(f.signerId))) throw new EsignError(`Field ${i + 1} is assigned to an unknown signer`);
    if (!(FIELD_TYPES as readonly string[]).includes(f.type)) throw new EsignError(`Field ${i + 1} has an unknown type`);
    const page = Math.floor(Number(f.page));
    if (!(page >= 1 && page <= doc.pageCount)) throw new EsignError(`Field ${i + 1} is on a page that doesn't exist`);
    const w = clamp(f.w, 0.01, 1), h = clamp(f.h, 0.005, 1);
    const x = clamp(f.x, 0, 1 - w), y = clamp(f.y, 0, 1 - h);
    if ([x, y, w, h].some((n) => Number.isNaN(n))) throw new EsignError(`Field ${i + 1} has an invalid position`);
    return { companyId, documentId, signerId: String(f.signerId), type: f.type, page, x, y, w, h, required: f.required !== false, label: typeof f.label === "string" ? f.label.trim().slice(0, 80) || null : null };
  });
  await db.transaction(async (tx) => {
    await tx.delete(esignFields).where(eq(esignFields.documentId, documentId));
    if (rows.length) await tx.insert(esignFields).values(rows);
  });
  return db.select().from(esignFields).where(eq(esignFields.documentId, documentId)).orderBy(asc(esignFields.page), asc(esignFields.createdAt));
}

// ── Admin: send / remind / void ─────────────────────────────────────────────
async function senderName(companyId: string, userId: string): Promise<string> {
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name || "Your sender";
}

export async function sendDocument(companyId: string, userId: string, documentId: string, message?: string | null) {
  const doc = await requireDraft(companyId, documentId);
  const signers = await db.select().from(esignSigners).where(eq(esignSigners.documentId, documentId)).orderBy(asc(esignSigners.position));
  if (signers.length === 0) throw new EsignError("Add at least one signer before sending");
  const fields = await db.select({ signerId: esignFields.signerId, type: esignFields.type }).from(esignFields).where(eq(esignFields.documentId, documentId));
  for (const s of signers) {
    if (!fields.some((f) => f.signerId === s.id && f.type === "signature")) throw new EsignError(`${s.name} has no signature field. Place at least one signature field for every signer.`);
  }
  const note = message !== undefined && message !== null ? message.trim().slice(0, 2000) || null : doc.message;
  await db.update(esignDocuments).set({ status: "sent", sentAt: new Date(), message: note, updatedAt: new Date() }).where(eq(esignDocuments.id, documentId));
  const sender = await senderName(companyId, userId);
  const results: { signerId: string; email: string; ok: boolean; reason?: string }[] = [];
  for (const s of signers) {
    const res = await sendSigningRequestEmail({ to: s.email, signerName: s.name, sender, title: doc.title, message: note, link: signingUrl(s.token) });
    await db.update(esignSigners).set({ status: "sent", sentAt: new Date() }).where(eq(esignSigners.id, s.id));
    results.push({ signerId: s.id, email: s.email, ok: res.ok, reason: res.reason });
  }
  await logEvent(companyId, documentId, "sent", { detail: `Sent to ${signers.map((s) => s.email).join(", ")}` });
  await recordAudit({ companyId, userId, action: "esign.document_sent", entityType: "esign_document", entityId: documentId, after: { signers: signers.length, emailed: results.filter((r) => r.ok).length } });
  return { results };
}

export async function remindSigner(companyId: string, userId: string, documentId: string, signerId: string) {
  const [doc] = await db.select().from(esignDocuments).where(and(eq(esignDocuments.id, documentId), eq(esignDocuments.companyId, companyId))).limit(1);
  if (!doc) throw new EsignError("Document not found", 404);
  if (doc.status !== "sent") throw new EsignError("Only a sent document can be re-sent");
  const [s] = await db.select().from(esignSigners).where(and(eq(esignSigners.id, signerId), eq(esignSigners.documentId, documentId))).limit(1);
  if (!s) throw new EsignError("Signer not found", 404);
  if (s.status === "signed") throw new EsignError(`${s.name} has already signed`);
  const res = await sendSigningRequestEmail({ to: s.email, signerName: s.name, sender: await senderName(companyId, userId), title: doc.title, message: doc.message, link: signingUrl(s.token), reminder: true });
  await logEvent(companyId, documentId, "reminded", { signerId, detail: res.ok ? `Reminder sent to ${s.email}` : `Reminder to ${s.email} failed: ${res.reason}` });
  return res;
}

export async function voidDocument(companyId: string, userId: string, documentId: string, reason?: string | null) {
  const [doc] = await db.select().from(esignDocuments).where(and(eq(esignDocuments.id, documentId), eq(esignDocuments.companyId, companyId))).limit(1);
  if (!doc) throw new EsignError("Document not found", 404);
  if (doc.status === "voided") throw new EsignError("Already voided");
  if (doc.status === "completed") throw new EsignError("A completed document can't be voided");
  await db.update(esignDocuments).set({ status: "voided", voidedAt: new Date(), voidReason: reason?.trim().slice(0, 500) || null, updatedAt: new Date() }).where(eq(esignDocuments.id, documentId));
  await logEvent(companyId, documentId, "voided", { detail: reason?.trim() || null });
  await recordAudit({ companyId, userId, action: "esign.document_voided", entityType: "esign_document", entityId: documentId, after: { reason: reason ?? null } });
}

// ── Signer side (token = authorization) ─────────────────────────────────────
export async function getByToken(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const [signer] = await db.select().from(esignSigners).where(eq(esignSigners.token, token)).limit(1);
  if (!signer) return null;
  const [doc] = await db.select().from(esignDocuments).where(eq(esignDocuments.id, signer.documentId)).limit(1);
  if (!doc) return null;
  const [fields, allSigners] = await Promise.all([
    db.select().from(esignFields).where(eq(esignFields.documentId, doc.id)).orderBy(asc(esignFields.page), asc(esignFields.createdAt)),
    db.select({ id: esignSigners.id, name: esignSigners.name, status: esignSigners.status, color: esignSigners.color }).from(esignSigners).where(eq(esignSigners.documentId, doc.id)).orderBy(asc(esignSigners.position)),
  ]);
  return { signer, doc, fields, allSigners };
}

// What the signer page shows. Fields of OTHER signers are included read-only
// (so a counter-signer sees where the first party signed), their values too.
export async function signerView(token: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const data = await getByToken(token);
  if (!data) return null;
  const { signer, doc } = data;
  if (doc.status === "sent" && (signer.status === "sent" || signer.status === "pending")) {
    await db.update(esignSigners).set({ status: "viewed", viewedAt: new Date(), ipAddress: meta.ip?.slice(0, 64) ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null }).where(eq(esignSigners.id, signer.id));
    await logEvent(doc.companyId, doc.id, "viewed", { signerId: signer.id, ip: meta.ip, userAgent: meta.userAgent });
    signer.status = "viewed";
  }
  const sender = doc.createdBy ? await senderName(doc.companyId, doc.createdBy) : "Your sender";
  return {
    document: { id: doc.id, title: doc.title, pageCount: doc.pageCount, status: doc.status, message: doc.message, sender, completedAt: doc.completedAt },
    signer: { id: signer.id, name: signer.name, email: signer.email, status: signer.status, color: signer.color, signedAt: signer.signedAt, declinedAt: signer.declinedAt, signatureData: signer.signatureData, initialsData: signer.initialsData },
    signers: data.allSigners,
    fields: data.fields.map((f) => ({ ...f, mine: f.signerId === signer.id })),
    // Other signers' adopted signatures, so their completed fields render.
    signatures: Object.fromEntries((await db.select({ id: esignSigners.id, signatureData: esignSigners.signatureData, initialsData: esignSigners.initialsData }).from(esignSigners).where(eq(esignSigners.documentId, doc.id))).map((s) => [s.id, { signature: s.signatureData, initials: s.initialsData }])),
  };
}

const DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export async function submitSignature(token: string, input: { signatureData?: string | null; initialsData?: string | null; values: Record<string, string | boolean> }, meta: { ip?: string | null; userAgent?: string | null }) {
  const data = await getByToken(token);
  if (!data) throw new EsignError("This signing link is not valid", 404);
  const { signer, doc, fields } = data;
  if (doc.status === "voided") throw new EsignError("This document was voided by the sender", 410);
  if (doc.status === "completed" || signer.status === "signed") throw new EsignError("This document has already been signed", 409);
  if (signer.status === "declined") throw new EsignError("You declined this document", 409);
  if (doc.status !== "sent") throw new EsignError("This document is not open for signing", 409);

  const mine = fields.filter((f) => f.signerId === signer.id);
  const needsSig = mine.some((f) => f.type === "signature");
  const needsInit = mine.some((f) => f.type === "initials");
  const sig = input.signatureData ?? signer.signatureData;
  const ini = input.initialsData ?? signer.initialsData;
  if (needsSig && (!sig || !DATA_URL_RE.test(sig))) throw new EsignError("Please adopt your signature first");
  if (needsInit && (!ini || !DATA_URL_RE.test(ini))) throw new EsignError("Please adopt your initials first");
  if ((sig && sig.length > 400_000) || (ini && ini.length > 400_000)) throw new EsignError("Signature image is too large");

  const values = input.values && typeof input.values === "object" ? input.values : {};
  const updates: { id: string; value: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const f of mine) {
    let value: string | null = null;
    if (f.type === "signature" || f.type === "initials") value = values[f.id] === false ? null : "applied";
    else if (f.type === "checkbox") value = values[f.id] === true || values[f.id] === "true" ? "true" : null;
    else if (f.type === "date") value = typeof values[f.id] === "string" && values[f.id] ? String(values[f.id]).slice(0, 40) : today;
    else value = typeof values[f.id] === "string" ? String(values[f.id]).trim().slice(0, 500) || null : null;
    if (f.required && !value) throw new EsignError(`Please complete every required field (${f.label || f.type} on page ${f.page})`);
    if (value) updates.push({ id: f.id, value });
  }

  await db.transaction(async (tx) => {
    for (const u of updates) await tx.update(esignFields).set({ value: u.value, filledAt: new Date() }).where(eq(esignFields.id, u.id));
    await tx
      .update(esignSigners)
      .set({ status: "signed", signedAt: new Date(), signatureData: sig ?? null, initialsData: ini ?? null, ipAddress: meta.ip?.slice(0, 64) ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null })
      .where(eq(esignSigners.id, signer.id));
  });
  await logEvent(doc.companyId, doc.id, "signed", { signerId: signer.id, ip: meta.ip, userAgent: meta.userAgent, detail: `${signer.name} <${signer.email}> signed` });

  // Last signer → generate the signed PDF and notify everyone.
  const remaining = await db.select({ id: esignSigners.id }).from(esignSigners).where(and(eq(esignSigners.documentId, doc.id), eq(esignSigners.status, "viewed")));
  const others = await db.select({ status: esignSigners.status }).from(esignSigners).where(eq(esignSigners.documentId, doc.id));
  const allSigned = others.every((s) => s.status === "signed") && remaining.length === 0;
  let completed = false;
  if (allSigned) {
    await finalizeDocument(doc.companyId, doc.id);
    completed = true;
  }
  return { completed };
}

export async function declineDocument(token: string, reason: string | null, meta: { ip?: string | null; userAgent?: string | null }) {
  const data = await getByToken(token);
  if (!data) throw new EsignError("This signing link is not valid", 404);
  const { signer, doc } = data;
  if (doc.status !== "sent") throw new EsignError("This document is not open for signing", 409);
  if (signer.status === "signed") throw new EsignError("You have already signed this document", 409);
  const why = reason?.trim().slice(0, 500) || null;
  await db.update(esignSigners).set({ status: "declined", declinedAt: new Date(), declineReason: why, ipAddress: meta.ip?.slice(0, 64) ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null }).where(eq(esignSigners.id, signer.id));
  await logEvent(doc.companyId, doc.id, "declined", { signerId: signer.id, ip: meta.ip, userAgent: meta.userAgent, detail: why });
  if (doc.createdBy) {
    const [admin] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, doc.createdBy)).limit(1);
    if (admin?.email) await sendDeclinedEmail({ to: admin.email, adminName: admin.name, signerName: signer.name, signerEmail: signer.email, title: doc.title, reason: why, link: `${getPublicAppUrl()}/esign/${doc.id}` });
  }
}

async function finalizeDocument(companyId: string, documentId: string) {
  const [doc] = await db.select().from(esignDocuments).where(eq(esignDocuments.id, documentId)).limit(1);
  if (!doc || doc.status === "completed") return;
  const original = await getFile(companyId, documentId, "original");
  if (!original) throw new EsignError("Original file is missing", 500);
  const [signers, fields, events] = await Promise.all([
    db.select().from(esignSigners).where(eq(esignSigners.documentId, documentId)).orderBy(asc(esignSigners.position)),
    db.select().from(esignFields).where(eq(esignFields.documentId, documentId)),
    db.select().from(esignEvents).where(eq(esignEvents.documentId, documentId)).orderBy(asc(esignEvents.createdAt)),
  ]);
  const bytes = await buildSignedPdf({ original, doc, signers, fields, events });
  await db.transaction(async (tx) => {
    await tx.delete(esignFiles).where(and(eq(esignFiles.documentId, documentId), eq(esignFiles.kind, "signed")));
    await tx.insert(esignFiles).values({ companyId, documentId, kind: "signed", data: Buffer.from(bytes) });
    await tx.update(esignDocuments).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(esignDocuments.id, documentId));
  });
  await logEvent(companyId, documentId, "completed", { detail: `Signed PDF generated (${bytes.length} bytes)` });
  // Everyone gets the completed copy: each signer via their own link, the admin via the document page.
  const recipients = signers.map((s) => ({ to: s.email, name: s.name, link: signingUrl(s.token) }));
  if (doc.createdBy) {
    const [admin] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, doc.createdBy)).limit(1);
    if (admin?.email) recipients.push({ to: admin.email, name: admin.name, link: `${getPublicAppUrl()}/esign/${documentId}` });
  }
  for (const r of recipients) await sendCompletedEmail({ to: r.to, name: r.name, title: doc.title, link: r.link, pdf: Buffer.from(bytes), fileName: `${doc.title.replace(/[^\w.-]+/g, "_")}-signed.pdf` });
}

export async function signedFileByToken(token: string) {
  const data = await getByToken(token);
  if (!data || data.doc.status !== "completed") return null;
  const bytes = await getFile(data.doc.companyId, data.doc.id, "signed");
  return bytes ? { bytes, title: data.doc.title } : null;
}
export async function originalFileByToken(token: string) {
  const data = await getByToken(token);
  if (!data) return null;
  const bytes = await getFile(data.doc.companyId, data.doc.id, "original");
  return bytes ? { bytes, title: data.doc.title } : null;
}
