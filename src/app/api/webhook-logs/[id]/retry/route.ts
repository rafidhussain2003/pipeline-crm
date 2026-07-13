import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { webhookLogs, leadSources, leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, sql } from "drizzle-orm";
import { mapPayloadToLead, FieldMapping } from "@/lib/field-mapping";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/lead-sources/registry";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [log] = await db
    .select()
    .from(webhookLogs)
    .where(and(eq(webhookLogs.id, id), eq(webhookLogs.companyId, session.companyId)))
    .limit(1);
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!log.payload) return NextResponse.json({ error: "No payload was captured for this log entry" }, { status: 400 });
  if (!log.sourceId) return NextResponse.json({ error: "This log has no associated source" }, { status: 400 });

  // Idempotency guard: once a retry has actually created a lead, retrying
  // the same log entry again must not create a second one. A failed retry
  // (status stays whatever it was) can still be retried — only a
  // previously-*successful* retry is blocked.
  if (log.status === "retried") {
    return NextResponse.json({ error: "This webhook was already successfully retried." }, { status: 409 });
  }

  const [source] = await db.select().from(leadSources).where(eq(leadSources.id, log.sourceId)).limit(1);
  if (!source) return NextResponse.json({ error: "Source no longer exists" }, { status: 400 });

  try {
    // Facebook's logged payload is the raw webhook change.value
    // (leadgen_id/page_id/form_id only — never the lead's actual
    // name/phone/email, which Facebook never puts in the webhook body).
    // Retrying it means re-attempting the same Graph API fetch the
    // original delivery attempted, not remapping fields out of a payload
    // that was never shaped like a lead. Every other platform's payload
    // IS the lead data itself, so mapPayloadToLead applies directly there.
    let name: string;
    let phone: string | null;
    let email: string | null;
    let rawPayload: unknown;
    // Set only for Facebook — feeds the same (sourceId, externalLeadId)
    // unique dedup index ingestLead() uses, so a retry can never create a
    // duplicate of a lead that already arrived live (or via import) for the
    // same leadgen_id.
    let externalLeadId: string | null = null;

    if (source.platform === "facebook") {
      const leadgenId = (log.payload as { leadgen_id?: string }).leadgen_id;
      if (!leadgenId) return NextResponse.json({ error: "This log has no leadgen_id to retry" }, { status: 400 });
      if (!source.accessToken) return NextResponse.json({ error: "This source has no access token — reconnect it first" }, { status: 400 });
      const provider = getProvider("facebook")!;
      const fbLead = await provider.fetchLead(leadgenId, decrypt(source.accessToken));
      name = fbLead.name || "Unknown";
      phone = fbLead.phone;
      email = fbLead.email;
      rawPayload = fbLead.raw;
      externalLeadId = leadgenId;
    } else {
      const mapping = (source.fieldMapping as FieldMapping) || { name: "name", phone: "phone", email: "email" };
      const mapped = mapPayloadToLead(log.payload, mapping);
      name = mapped.name || "Unknown";
      phone = mapped.phone ?? null;
      email = mapped.email ?? null;
      rawPayload = log.payload;
    }

    const duplicateOfLeadId = await findDuplicateLead(source.companyId, phone, email);

    const [lead] = await db
      .insert(leads)
      .values({
        companyId: source.companyId,
        sourceId: source.id,
        externalLeadId,
        name,
        phone,
        email,
        disposition: "New Lead",
        rawPayload: rawPayload as object,
        isDuplicate: !!duplicateOfLeadId,
        duplicateOfLeadId,
      })
      .onConflictDoNothing({ target: [leads.sourceId, leads.externalLeadId], where: sql`${leads.externalLeadId} IS NOT NULL` })
      .returning();

    // Conflict → this leadgen_id already became a lead (e.g. a live delivery
    // landed first). Idempotent success: mark the log resolved, don't create
    // a second lead.
    if (!lead) {
      await db.update(webhookLogs).set({ status: "retried", retryCount: log.retryCount + 1, error: null }).where(eq(webhookLogs.id, id));
      return NextResponse.json({ ok: true, deduped: true });
    }

    let assignmentError: string | null = null;
    try {
      await assignLead(lead.id, source.companyId);
    } catch (err) {
      // Lead was already created — don't let an assignment failure clear
      // the idempotency guard below (that would allow a duplicate on a
      // second retry attempt), but do reflect it in the log row.
      console.error(`Lead assignment failed during webhook retry (lead ${lead.id}):`, err);
      assignmentError = err instanceof Error ? err.message : "Assignment failed";
    }

    await db
      .update(webhookLogs)
      .set({
        status: "retried",
        stage: assignmentError ? "lead_stored" : "completed",
        leadId: lead.id,
        retryCount: log.retryCount + 1,
        processingTimeMs: Date.now() - startedAt,
        error: assignmentError,
      })
      .where(eq(webhookLogs.id, id));

    return NextResponse.json({ ok: true, leadId: lead.id });
  } catch (err) {
    await db
      .update(webhookLogs)
      .set({
        retryCount: log.retryCount + 1,
        processingTimeMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : "Retry failed",
      })
      .where(eq(webhookLogs.id, id));
    return NextResponse.json({ error: "Retry failed" }, { status: 500 });
  }
}
