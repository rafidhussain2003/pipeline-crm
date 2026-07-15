// The shared "already-parsed lead data -> lead in the CRM" pipeline for
// PUSH-style sources whose payload already contains the lead (the Universal
// Webhook and Website Forms — as opposed to Facebook, which delivers a bare
// id we must fetch, see ingest-lead.ts). One implementation so a website
// form submission and a webhook POST go through the exact same
// dedup -> store -> assign -> Delivery Log -> (implicit) assignment/audit
// logging, and can never silently drift apart.
import { db } from "@/db";
import { leadSources, leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";
import { recordDeliveryLog } from "@/lib/delivery-log";
import { recordAudit } from "@/lib/audit";
import { metrics } from "@/lib/infra/metrics";

type Source = typeof leadSources.$inferSelect;

export type InboundIngestResult = { leadId: string; assignmentFailed: boolean };

// Stores one already-parsed lead and runs it through the assignment engine.
// `rawPayload` is the full original submission (custom/hidden fields, UTM,
// referrer, device, etc. for a website form) — kept verbatim on the lead so
// nothing the source sent is lost. Assignment failure never rolls back the
// lead (it's kept, retried by the queue sweep) — it's only reflected in the
// Delivery Log row, exactly like the live Facebook and generic paths.
export async function ingestInboundLead(params: {
  source: Source;
  name: string | null;
  phone: string | null;
  email: string | null;
  rawPayload: unknown;
  startedAt: number;
}): Promise<InboundIngestResult> {
  const { source, name, phone, email, rawPayload, startedAt } = params;

  const duplicateOfLeadId = await findDuplicateLead(source.companyId, phone, email);

  const [lead] = await db
    .insert(leads)
    .values({
      companyId: source.companyId,
      sourceId: source.id,
      name: name || "Unknown",
      phone,
      email,
      disposition: "New Lead",
      rawPayload: rawPayload as object,
      isDuplicate: !!duplicateOfLeadId,
      duplicateOfLeadId,
    })
    .returning();

  let assignmentError: string | null = null;
  try {
    await assignLead(lead.id, source.companyId);
  } catch (err) {
    console.error(`Lead assignment failed for inbound lead ${lead.id}:`, err);
    assignmentError = err instanceof Error ? err.message : "Assignment failed";
  }

  await db.update(leadSources).set({ lastSyncedAt: new Date() }).where(eq(leadSources.id, source.id));

  await recordDeliveryLog({
    sourceId: source.id,
    companyId: source.companyId,
    status: assignmentError ? "failed" : "success",
    stage: assignmentError ? "lead_stored" : "completed",
    startedAt,
    leadId: lead.id,
    payload: rawPayload,
    error: assignmentError,
  });

  // Audit trail parity with the Facebook path (lead.created_from_facebook) —
  // a website-form or webhook lead is just as much a "lead arrived" event and
  // belongs in the Audit Log the same way.
  await recordAudit({
    companyId: source.companyId,
    userId: null,
    action: source.platform === "website" ? "lead.created_from_website" : "lead.created_from_webhook",
    entityType: "lead",
    entityId: lead.id,
    metadata: { sourceId: source.id, platform: source.platform, isDuplicate: !!duplicateOfLeadId, assignmentFailed: !!assignmentError },
  });

  // Phase 10 observability: end-to-end inbound ingest latency (dedup → store →
  // assign → delivery log).
  metrics.recordTiming("ingest.lead_ms", Date.now() - startedAt);

  return { leadId: lead.id, assignmentFailed: !!assignmentError };
}
