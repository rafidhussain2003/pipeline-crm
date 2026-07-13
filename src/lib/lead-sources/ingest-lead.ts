// The single "given one Facebook lead's data, get it into the CRM" pipeline
// — store -> assign -> connection health -> Delivery Log -> Audit Log.
// Used by BOTH the live webhook receiver (api/webhooks/facebook/route.ts)
// and the historical importer (lib/lead-sources/import-engine.ts) so an
// imported lead goes through exactly the same processing a live lead does,
// not a parallel implementation that could silently drift from it.
import { db } from "@/db";
import { leadSources, leads } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";
import { recordAudit } from "@/lib/audit";
import { recordDeliveryLog } from "@/lib/delivery-log";

type Source = typeof leadSources.$inferSelect;

export type IngestResult =
  | { outcome: "duplicate"; leadId: string }
  | { outcome: "imported"; leadId: string; assignmentFailed: boolean };

export async function ingestLead(params: {
  source: Source;
  leadgenId: string;
  formId: string | null;
  fbLead: { name: string | null; phone: string | null; email: string | null; raw: unknown };
  startedAt: number;
  webhookLatencyMs?: number | null;
  // What Retry (api/webhook-logs/[id]/retry) re-fetches from — always this
  // same {leadgen_id, page_id, form_id} shape regardless of whether this
  // lead arrived live or via import, so Retry needs no special-casing.
  retryPayload: unknown;
}): Promise<IngestResult> {
  const { source, leadgenId, formId, fbLead, startedAt, retryPayload } = params;
  const webhookLatencyMs = params.webhookLatencyMs ?? null;

  const duplicateOfLeadId = await findDuplicateLead(source.companyId, fbLead.phone, fbLead.email);

  // Atomic dedup by provider lead id — the single point that guarantees
  // "never create a duplicate lead." Facebook's webhook delivery is
  // at-least-once (the same leadgen_id can arrive twice), and a historical
  // import can also race a live webhook delivery for the very same lead. A
  // prior version SELECT-then-INSERTed, which two concurrent callers could
  // both pass before either inserted, producing duplicates. This
  // insert-on-conflict against the (sourceId, externalLeadId) partial
  // unique index (see leads table in db/schema.ts) makes the second writer
  // a no-op at the database level — safe under any concurrency, including a
  // future multi-instance deployment.
  const [lead] = await db
    .insert(leads)
    .values({
      companyId: source.companyId,
      sourceId: source.id,
      externalLeadId: leadgenId,
      name: fbLead.name || "Unknown",
      phone: fbLead.phone,
      email: fbLead.email,
      disposition: "New Lead",
      rawPayload: fbLead.raw,
      isDuplicate: !!duplicateOfLeadId,
      duplicateOfLeadId,
    })
    // `where` mirrors the partial index's predicate — Postgres requires it
    // to select a partial unique index as the ON CONFLICT arbiter.
    .onConflictDoNothing({ target: [leads.sourceId, leads.externalLeadId], where: sql`${leads.externalLeadId} IS NOT NULL` })
    .returning();

  if (!lead) {
    // Conflict → this leadgen_id already exists for this source. Look up the
    // existing lead so the Delivery Log row can point at it, and report it
    // as a skipped duplicate exactly as before.
    const [existing] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.sourceId, source.id), eq(leads.externalLeadId, leadgenId)))
      .limit(1);
    await recordDeliveryLog({
      sourceId: source.id,
      companyId: source.companyId,
      status: "skipped",
      stage: "completed",
      startedAt,
      formId,
      leadId: existing?.id ?? null,
      webhookLatencyMs,
      error: "Duplicate delivery — this leadgen_id was already processed",
    });
    return { outcome: "duplicate", leadId: existing?.id ?? "" };
  }

  let assignmentError: string | null = null;
  try {
    await assignLead(lead.id, source.companyId);
  } catch (err) {
    // Lead already created — kept, not rolled back (a live redelivery would
    // otherwise risk a duplicate; an import retry would otherwise re-fetch
    // the same lead for nothing). Reported as a failed delivery
    // (stage="lead_stored", one step short of "lead_assigned") instead of
    // being silently counted as a success.
    console.error(`Lead assignment failed for lead ${lead.id}:`, err);
    assignmentError = err instanceof Error ? err.message : "Assignment failed";
  }

  await db
    .update(leadSources)
    .set({ lastSyncedAt: new Date(), status: "connected", webhookStatus: "active", lastError: null })
    .where(eq(leadSources.id, source.id));

  await recordDeliveryLog({
    sourceId: source.id,
    companyId: source.companyId,
    status: assignmentError ? "failed" : "success",
    stage: assignmentError ? "lead_stored" : "completed",
    startedAt,
    leadId: lead.id,
    formId,
    payload: retryPayload,
    webhookLatencyMs,
    error: assignmentError,
  });

  await recordAudit({
    companyId: source.companyId,
    userId: null,
    action: "lead.created_from_facebook",
    entityType: "lead",
    entityId: lead.id,
    metadata: {
      sourceId: source.id,
      pageId: source.pageId,
      formId,
      isDuplicate: !!duplicateOfLeadId,
      assignmentFailed: !!assignmentError,
    },
  });

  return { outcome: "imported", leadId: lead.id, assignmentFailed: !!assignmentError };
}
