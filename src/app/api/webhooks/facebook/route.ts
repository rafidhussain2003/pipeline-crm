import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leadForms, leads } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/lead-sources/registry";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";
import { recordAudit } from "@/lib/audit";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { recordDeliveryLog } from "@/lib/delivery-log";

const metaProvider = getProvider("facebook")!;

// --- Verification handshake (Facebook calls this once when you register the webhook) ---
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.FACEBOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

type LeadgenValue = { leadgen_id?: string; page_id?: string; form_id?: string };

// Processes exactly one leadgen change and ALWAYS writes exactly one
// Delivery Log row before returning (except for the two cases with no
// tenant to attribute a row to — see the comments at those two branches).
// This is the pipeline the Lead Delivery Health panel and Delivery Log
// page are built on: received -> lead_downloaded -> lead_stored ->
// lead_assigned -> completed. `stage` on a non-success row is the last
// stage actually reached before it stopped.
async function processLeadgenChange(value: LeadgenValue, startedAt: number, webhookLatencyMs: number | null) {
  const { leadgen_id: leadgenId, page_id: pageId, form_id: formId } = value;
  if (!leadgenId || !pageId) {
    // Malformed event — no page/leadgen id means no source and no company
    // to attribute a Delivery Log row to. Server-log only, same as before.
    console.error("Facebook webhook: leadgen change missing leadgen_id or page_id:", value);
    return;
  }

  const [source] = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.pageId, pageId), isNull(leadSources.deletedAt)))
    .limit(1);

  if (!source) {
    // No connected source for this page at all — could be stale Meta
    // subscription state from a page disconnected without unsubscribing.
    // No company to attribute this to, so server-log only (matches the
    // same reasoning as the malformed-event case above).
    console.error(`Facebook webhook: no connected source for page ${pageId}`);
    return;
  }

  // Customer explicitly disconnected this page (Facebook's own unsubscribe
  // can lag a Disconnect click by a delivery or two) or has no token to
  // call the Graph API with — both are expected, not failures, so this is
  // "skipped" rather than "failed".
  if (!source.accessToken || source.status === "disconnected") {
    await recordDeliveryLog({
      sourceId: source.id,
      companyId: source.companyId,
      status: "skipped",
      stage: "received",
      startedAt,
      formId: formId ?? null,
      webhookLatencyMs,
      error: source.status === "disconnected" ? "Source is disconnected" : "No access token stored for this source",
    });
    return;
  }

  // Facebook's page-level webhook subscription can't be scoped to
  // individual forms — it delivers events for every form on the page.
  // Only act on ones the customer explicitly ticked when connecting (see
  // finalize/route.ts). A source with zero enabled forms is intentional,
  // not broken — logged as skipped so "why didn't this lead show up" is
  // always answerable without a server-log search.
  if (formId) {
    const [enabledForm] = await db
      .select({ id: leadForms.id })
      .from(leadForms)
      .where(and(eq(leadForms.sourceId, source.id), eq(leadForms.formId, formId), eq(leadForms.enabled, true)))
      .limit(1);
    if (!enabledForm) {
      await recordDeliveryLog({
        sourceId: source.id,
        companyId: source.companyId,
        status: "skipped",
        stage: "received",
        startedAt,
        formId,
        webhookLatencyMs,
        error: "This form is not enabled for lead capture",
      });
      return;
    }
  }

  // Facebook's webhook delivery is at-least-once, not exactly-once — the
  // same leadgen_id can arrive more than once (retries, network blips on
  // Facebook's end). rawPayload->>'id' is the Graph API lead object's own
  // id, i.e. leadgen_id, for every lead this route has ever created —
  // checking it here makes a duplicate delivery a no-op instead of a
  // second lead row.
  const [alreadyProcessed] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.companyId, source.companyId),
        eq(leads.sourceId, source.id),
        sql`${leads.rawPayload}->>'id' = ${leadgenId}`
      )
    )
    .limit(1);
  if (alreadyProcessed) {
    await recordDeliveryLog({
      sourceId: source.id,
      companyId: source.companyId,
      status: "skipped",
      stage: "completed",
      startedAt,
      formId: formId ?? null,
      leadId: alreadyProcessed.id,
      webhookLatencyMs,
      error: "Duplicate delivery — this leadgen_id was already processed",
    });
    return;
  }

  const token = decrypt(source.accessToken);

  let fbLead: Awaited<ReturnType<typeof metaProvider.fetchLead>>;
  try {
    fbLead = await metaProvider.fetchLead(leadgenId, token);
  } catch (err) {
    console.error(`Facebook webhook: failed to fetch lead ${leadgenId}:`, err);
    const errorStatus = metaProvider.classifyError(err);
    const message = err instanceof Error ? err.message : "Unknown Graph API error";
    await db.update(leadSources).set({ status: errorStatus, lastError: message }).where(eq(leadSources.id, source.id));
    await recordDeliveryLog({
      sourceId: source.id,
      companyId: source.companyId,
      status: "failed",
      stage: "received",
      startedAt,
      formId: formId ?? null,
      webhookLatencyMs,
      error: message,
      // Kept so Retry (see api/webhook-logs/[id]/retry) has the leadgen_id
      // it needs to re-attempt the Graph API fetch.
      payload: value,
    });
    return;
  }

  const duplicateOfLeadId = await findDuplicateLead(source.companyId, fbLead.phone, fbLead.email);

  const [lead] = await db
    .insert(leads)
    .values({
      companyId: source.companyId,
      sourceId: source.id,
      name: fbLead.name || "Unknown",
      phone: fbLead.phone,
      email: fbLead.email,
      disposition: "New Lead",
      rawPayload: fbLead.raw,
      isDuplicate: !!duplicateOfLeadId,
      duplicateOfLeadId,
    })
    .returning();

  let assignmentError: string | null = null;
  try {
    await assignLead(lead.id, source.companyId);
  } catch (err) {
    // The lead was already created — kept, not rolled back, since Facebook
    // would otherwise retry this delivery and risk a duplicate on the next
    // attempt. What changes here vs. before: this is now reported as a
    // failed delivery (stage="lead_stored", one step short of
    // "lead_assigned") instead of being silently counted as a success.
    console.error(`Lead assignment failed for Facebook lead ${lead.id}:`, err);
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
    formId: formId ?? null,
    payload: value,
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
      pageId,
      formId: formId || null,
      isDuplicate: !!duplicateOfLeadId,
      assignmentFailed: !!assignmentError,
    },
  });
}

// --- Real-time leadgen events ---
// Facebook expects a fast 200 response. We do the minimum synchronous work
// needed (look up the source + fetch the lead) and return quickly; at higher
// volume this handler's body can be moved into a queue worker unchanged.
export async function POST(req: NextRequest) {
  // Generous limit — set well above real Facebook leadgen delivery volume,
  // this only exists to catch actual abuse (someone hammering the URL
  // directly), not to throttle legitimate webhook traffic.
  const rl = checkPolicy("webhook.facebook", getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    // Log but still return 200 — Facebook retries aggressively on non-200s,
    // and we don't want a malformed payload to cause a retry storm.
    console.error("Facebook webhook: invalid JSON body:", err);
    return NextResponse.json({ received: true });
  }

  const entries = body.entry || [];
  for (const entry of entries) {
    // `entry.time` is the Unix epoch (seconds) at which Meta generated the
    // event — diffed against our own receipt time for webhookLatencyMs.
    const receivedAt = Date.now();
    const webhookLatencyMs = typeof entry.time === "number" ? Math.max(0, receivedAt - entry.time * 1000) : null;

    const changes = entry.changes || [];
    for (const change of changes) {
      // Each entry is handled independently: one page's corrupted token or
      // one transient DB error shouldn't stop other entries in the same
      // delivery (potentially from other, healthy pages) from being
      // processed.
      const startedAt = Date.now();
      try {
        if (change.field !== "leadgen") continue;
        await processLeadgenChange(change.value || {}, startedAt, webhookLatencyMs);
      } catch (err) {
        console.error("Facebook webhook: failed to process one leadgen entry:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
