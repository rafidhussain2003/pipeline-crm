import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leads, webhookLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { mapPayloadToLead, FieldMapping } from "@/lib/field-mapping";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";

// Universal webhook connector: any tool that can POST JSON (Google Lead
// Forms via a relay like Zapier/Pabbly, a custom form builder, another CRM)
// can send leads here. The source's `webhookSecret` must be passed as a
// header (X-Webhook-Secret) to prove the caller is authorized, and
// `fieldMapping` (set when the source was created) tells us how to pull
// name/phone/email out of whatever JSON shape that tool sends.
export async function POST(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const ip = getClientIp(req);
  const rl = checkPolicy("webhook.generic", `${sourceId}:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const [source] = await db.select().from(leadSources).where(eq(leadSources.id, sourceId)).limit(1);
  if (!source || source.status !== "connected") {
    return NextResponse.json({ error: "Unknown or inactive webhook" }, { status: 404 });
  }

  const providedSecret = req.headers.get("x-webhook-secret");
  if (source.webhookSecret && providedSecret !== source.webhookSecret) {
    await db.insert(webhookLogs).values({
      sourceId: source.id,
      companyId: source.companyId,
      status: "failed",
      error: "Invalid or missing X-Webhook-Secret header",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    await db.insert(webhookLogs).values({
      sourceId: source.id,
      companyId: source.companyId,
      status: "failed",
      error: "Request body was not valid JSON",
    });
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const mapping = (source.fieldMapping as FieldMapping) || { name: "name", phone: "phone", email: "email" };
    const mapped = mapPayloadToLead(payload, mapping);

    const duplicateOfLeadId = await findDuplicateLead(source.companyId, mapped.phone, mapped.email);

    const [lead] = await db
      .insert(leads)
      .values({
        companyId: source.companyId,
        sourceId: source.id,
        name: mapped.name || "Unknown",
        phone: mapped.phone,
        email: mapped.email,
        disposition: "New Lead",
        rawPayload: payload as object,
        isDuplicate: !!duplicateOfLeadId,
        duplicateOfLeadId,
      })
      .returning();

    try {
      await assignLead(lead.id, source.companyId);
    } catch (err) {
      // The lead was already created — don't let an assignment failure
      // report this webhook as "failed" (that could trigger the sender's
      // retry logic and create a duplicate lead for an already-successful
      // capture). It's simply left unassigned.
      console.error(`Lead assignment failed for webhook lead ${lead.id}:`, err);
    }
    await db.update(leadSources).set({ lastSyncedAt: new Date() }).where(eq(leadSources.id, source.id));

    await db.insert(webhookLogs).values({
      sourceId: source.id,
      companyId: source.companyId,
      status: "success",
      payload: payload as object,
    });

    return NextResponse.json({ received: true, leadId: lead.id });
  } catch (err) {
    console.error("Generic webhook processing error:", err);
    await db.insert(webhookLogs).values({
      sourceId: source.id,
      companyId: source.companyId,
      status: "failed",
      payload: payload as object,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    // Still return 200-ish here would hide the failure from the sender;
    // for a generic webhook (unlike Facebook) we want the caller to know
    // it failed so their own retry logic (if any) can kick in. Our own
    // "Retry" button in the UI re-processes the logged payload too.
    return NextResponse.json({ error: "Failed to process lead" }, { status: 500 });
  }
}
