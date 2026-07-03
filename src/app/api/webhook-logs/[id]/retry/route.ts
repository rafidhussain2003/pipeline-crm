import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { webhookLogs, leadSources, leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { mapPayloadToLead, FieldMapping } from "@/lib/field-mapping";
import { assignLead } from "@/lib/assignment";
import { findDuplicateLead } from "@/lib/duplicates";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const [source] = await db.select().from(leadSources).where(eq(leadSources.id, log.sourceId)).limit(1);
  if (!source) return NextResponse.json({ error: "Source no longer exists" }, { status: 400 });

  try {
    const mapping = (source.fieldMapping as FieldMapping) || { name: "name", phone: "phone", email: "email" };
    const mapped = mapPayloadToLead(log.payload, mapping);
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
        rawPayload: log.payload,
        isDuplicate: !!duplicateOfLeadId,
        duplicateOfLeadId,
      })
      .returning();

    await assignLead(lead.id, source.companyId);

    await db
      .update(webhookLogs)
      .set({ status: "retried", retryCount: log.retryCount + 1, error: null })
      .where(eq(webhookLogs.id, id));

    return NextResponse.json({ ok: true, leadId: lead.id });
  } catch (err) {
    await db
      .update(webhookLogs)
      .set({ retryCount: log.retryCount + 1, error: err instanceof Error ? err.message : "Retry failed" })
      .where(eq(webhookLogs.id, id));
    return NextResponse.json({ error: "Retry failed" }, { status: 500 });
  }
}
