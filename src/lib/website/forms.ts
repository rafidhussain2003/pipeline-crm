// Hosted form builder (Phase 8) — create/list simple forms and read one for
// public rendering. Intentionally minimal field types; a submission from a
// hosted form goes through /api/forms/[sourceId] like any embedded form, so it
// reuses the whole ingestInboundLead pipeline (no duplicate logic).
import { db } from "@/db";
import { hostedForms, leadSources } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

export type FormFieldType = "text" | "email" | "phone" | "textarea" | "dropdown" | "checkbox";

export interface FormField {
  type: FormFieldType;
  name: string;
  label: string;
  required: boolean;
  options?: string[]; // dropdown only
  placeholder?: string;
}

const ALLOWED_TYPES = new Set<FormFieldType>(["text", "email", "phone", "textarea", "dropdown", "checkbox"]);
const MAX_FIELDS = 30;

// Sanitize an untrusted fields array into a safe FormField[] (bounded count,
// safe names, whitelisted types) — the schema is stored verbatim and later
// rendered, so it must be clean.
export function validateFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const out: FormField[] = [];
  const used = new Set<string>();
  for (const f of raw.slice(0, MAX_FIELDS)) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const type = String(o.type) as FormFieldType;
    if (!ALLOWED_TYPES.has(type)) continue;
    let name = String(o.name ?? "").trim().slice(0, 60).replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!name || used.has(name)) name = `field_${out.length + 1}`;
    used.add(name);
    const field: FormField = { type, name, label: String(o.label ?? name).slice(0, 120), required: !!o.required };
    if (type === "dropdown" && Array.isArray(o.options)) field.options = o.options.map((x) => String(x).slice(0, 120)).slice(0, 50);
    if (typeof o.placeholder === "string") field.placeholder = o.placeholder.slice(0, 120);
    out.push(field);
  }
  return out;
}

export async function createHostedForm(params: {
  companyId: string;
  sourceId: string;
  name: string;
  fields: FormField[];
  submitText?: string;
  successMessage?: string | null;
  redirectUrl?: string | null;
  createdBy?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(hostedForms)
    .values({
      companyId: params.companyId,
      sourceId: params.sourceId,
      name: params.name.slice(0, 255),
      fields: params.fields,
      submitText: (params.submitText || "Submit").slice(0, 100),
      successMessage: params.successMessage ?? null,
      redirectUrl: params.redirectUrl ?? null,
      createdBy: params.createdBy ?? null,
    })
    .returning({ id: hostedForms.id });
  return row.id;
}

export async function listHostedForms(companyId: string) {
  return db
    .select({ id: hostedForms.id, name: hostedForms.name, sourceId: hostedForms.sourceId, active: hostedForms.active, createdAt: hostedForms.createdAt, fields: hostedForms.fields })
    .from(hostedForms)
    .where(and(eq(hostedForms.companyId, companyId), isNull(hostedForms.deletedAt)))
    .orderBy(desc(hostedForms.createdAt));
}

// For the public /f/[formId] render: the form + the connection's public key
// (sourceId). Only returns active forms whose connection is still connected.
export async function getPublicHostedForm(formId: string) {
  const [row] = await db
    .select({
      id: hostedForms.id,
      name: hostedForms.name,
      fields: hostedForms.fields,
      submitText: hostedForms.submitText,
      successMessage: hostedForms.successMessage,
      redirectUrl: hostedForms.redirectUrl,
      active: hostedForms.active,
      publicKey: hostedForms.sourceId,
      sourceStatus: leadSources.status,
      companyId: leadSources.companyId,
    })
    .from(hostedForms)
    .innerJoin(leadSources, eq(leadSources.id, hostedForms.sourceId))
    .where(and(eq(hostedForms.id, formId), isNull(hostedForms.deletedAt)))
    .limit(1);
  if (!row || !row.active || row.sourceStatus !== "connected") return null;
  return row;
}
