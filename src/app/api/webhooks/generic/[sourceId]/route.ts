import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { mapPayloadToLead, FieldMapping } from "@/lib/field-mapping";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { recordDeliveryLog } from "@/lib/delivery-log";
import { ingestInboundLead } from "@/lib/lead-sources/ingest-inbound";

// Universal webhook connector: any tool that can POST JSON (Google Lead
// Forms via a relay like Zapier/Pabbly, a custom form builder, another CRM)
// can send leads here. The source's `webhookSecret` must be passed as a
// header (X-Webhook-Secret) to prove the caller is authorized, and
// `fieldMapping` (set when the source was created) tells us how to pull
// name/phone/email out of whatever JSON shape that tool sends.
//
// Shares webhookLogs/recordDeliveryLog with the Facebook receiver so both
// feed the same Delivery Log page. This receiver has no separate "download"
// step (the payload already contains the lead data), so its stages skip
// straight from "received" to "lead_stored".
export async function POST(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const startedAt = Date.now();
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
    await recordDeliveryLog({
      sourceId: source.id,
      companyId: source.companyId,
      status: "failed",
      stage: "received",
      startedAt,
      error: "Invalid or missing X-Webhook-Secret header",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    await recordDeliveryLog({
      sourceId: source.id,
      companyId: source.companyId,
      status: "failed",
      stage: "received",
      startedAt,
      error: "Request body was not valid JSON",
    });
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const mapping = (source.fieldMapping as FieldMapping) || { name: "name", phone: "phone", email: "email" };
    const mapped = mapPayloadToLead(payload, mapping);

    // Shared with the Website Forms endpoint — one dedup/store/assign/log path.
    const { leadId } = await ingestInboundLead({
      source,
      name: mapped.name ?? null,
      phone: mapped.phone ?? null,
      email: mapped.email ?? null,
      rawPayload: payload,
      startedAt,
    });

    return NextResponse.json({ received: true, leadId });
  } catch (err) {
    console.error("Generic webhook processing error:", err);
    await recordDeliveryLog({
      sourceId: source.id,
      companyId: source.companyId,
      status: "failed",
      stage: "received",
      startedAt,
      payload,
      error: err instanceof Error ? err.message : "Unknown error",
    });
    // Still return 200-ish here would hide the failure from the sender;
    // for a generic webhook (unlike Facebook) we want the caller to know
    // it failed so their own retry logic (if any) can kick in. Our own
    // "Retry" button in the UI re-processes the logged payload too.
    return NextResponse.json({ error: "Failed to process lead" }, { status: 500 });
  }
}
