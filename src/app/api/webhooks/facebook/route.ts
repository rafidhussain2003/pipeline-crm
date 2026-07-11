import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leadForms, leads, webhookLogs } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/lead-sources/registry";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";
import { recordAudit } from "@/lib/audit";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";

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
    const changes = entry.changes || [];
    for (const change of changes) {
      // Each entry is handled independently: one page's corrupted token or
      // one transient DB error shouldn't stop other entries in the same
      // delivery (potentially from other, healthy pages) from being
      // processed.
      try {
        if (change.field !== "leadgen") continue;
        const { leadgen_id, page_id, form_id } = change.value || {};
        if (!leadgen_id || !page_id) continue;

        const [source] = await db
          .select()
          .from(leadSources)
          .where(and(eq(leadSources.pageId, page_id), isNull(leadSources.deletedAt)))
          .limit(1);

        // No connected source for this page, or the customer explicitly
        // disconnected it (Facebook's own unsubscribe can lag a webhook
        // delivery or two behind a Disconnect click) — nothing to do.
        if (!source || !source.accessToken || source.status === "disconnected") continue;

        // Facebook's page-level webhook subscription can't be scoped to
        // individual forms — it delivers events for every form on the
        // page. Only act on ones the customer explicitly ticked when
        // connecting (see finalize/route.ts). A source with zero enabled
        // forms syncs nothing, by design, until forms are enabled.
        if (form_id) {
          const [enabledForm] = await db
            .select({ id: leadForms.id })
            .from(leadForms)
            .where(and(eq(leadForms.sourceId, source.id), eq(leadForms.formId, form_id), eq(leadForms.enabled, true)))
            .limit(1);
          if (!enabledForm) continue;
        }

        // Facebook's webhook delivery is at-least-once, not exactly-once —
        // the same leadgen_id can arrive more than once (retries, network
        // blips on Facebook's end). rawPayload->>'id' is the Graph API
        // lead object's own id, i.e. leadgen_id, for every lead this route
        // has ever created — checking it here makes a duplicate delivery a
        // no-op instead of a second lead row.
        const [alreadyProcessed] = await db
          .select({ id: leads.id })
          .from(leads)
          .where(
            and(
              eq(leads.companyId, source.companyId),
              eq(leads.sourceId, source.id),
              sql`${leads.rawPayload}->>'id' = ${leadgen_id}`
            )
          )
          .limit(1);
        if (alreadyProcessed) continue;

        const token = decrypt(source.accessToken);

        let fbLead: Awaited<ReturnType<typeof metaProvider.fetchLead>>;
        try {
          fbLead = await metaProvider.fetchLead(leadgen_id, token);
        } catch (err) {
          console.error(`Facebook webhook: failed to fetch lead ${leadgen_id}:`, err);
          const errorStatus = metaProvider.classifyError(err);
          await db
            .update(leadSources)
            .set({ status: errorStatus, lastError: err instanceof Error ? err.message : "Unknown Graph API error" })
            .where(eq(leadSources.id, source.id));
          await db.insert(webhookLogs).values({
            sourceId: source.id,
            companyId: source.companyId,
            status: "failed",
            payload: change.value,
            error: err instanceof Error ? err.message : "Unknown error",
          });
          continue;
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

        try {
          await assignLead(lead.id, source.companyId);
        } catch (err) {
          // The lead was already created — don't let an assignment failure
          // mark this delivery as failed (Facebook would retry and could
          // create a duplicate lead for an already-successful capture).
          console.error(`Lead assignment failed for Facebook lead ${lead.id}:`, err);
        }

        await db
          .update(leadSources)
          .set({ lastSyncedAt: new Date(), status: "connected", webhookStatus: "active", lastError: null })
          .where(eq(leadSources.id, source.id));

        await db.insert(webhookLogs).values({
          sourceId: source.id,
          companyId: source.companyId,
          status: "success",
          payload: change.value,
        });

        await recordAudit({
          companyId: source.companyId,
          userId: null,
          action: "lead.created_from_facebook",
          entityType: "lead",
          entityId: lead.id,
          metadata: { sourceId: source.id, pageId: page_id, formId: form_id || null, isDuplicate: !!duplicateOfLeadId },
        });
      } catch (err) {
        console.error("Facebook webhook: failed to process one leadgen entry:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
