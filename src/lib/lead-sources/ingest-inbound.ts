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
import { flagDuplicateLead } from "@/lib/duplicates";
import { recordDeliveryLog } from "@/lib/delivery-log";
import { recordAudit } from "@/lib/audit";
import { metrics } from "@/lib/infra/metrics";
import { eventBus } from "@/lib/events/bus";
import { normalizeLeadInput } from "@/lib/leads/input";
import "@/lib/capi/listeners"; // lead.created -> Conversions API enqueue
import "@/lib/insights/listeners"; // lead.created -> insight recompute

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
  const { source, rawPayload, startedAt } = params;
  // Normalize before storing: a website form or third-party webhook can send a
  // field longer than the column or of the wrong type, which previously threw a
  // raw Postgres error and lost the lead entirely.
  const { name, phone, email } = normalizeLeadInput(params);

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
    })
    .returning();

  // Duplicate flagging happens AFTER the insert, not before: a pre-insert
  // lookup is a check-then-insert race that concurrent identical submissions
  // all pass (measured: 5 simultaneous copies → 0 flagged). Post-insert, every
  // sibling is visible, so exactly the oldest stays unflagged.
  const duplicateOfLeadId = await flagDuplicateLead(lead.id, source.companyId, phone, email);

  // The domain event every other creation path fires. Previously only the
  // manual API emitted it, so Conversions-API `lead_created` and the insight
  // warm-up never ran for website/webhook leads — the exact leads that come
  // from paid ads. Both listeners only buffer in memory (they defer their work
  // to a macrotask), so this costs the webhook no measurable latency.
  await eventBus.emit("lead.created", { leadId: lead.id, companyId: source.companyId, source: "webhook" });

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
