import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookLogs, leadSources, leadForms } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: webhookLogs.id,
      status: webhookLogs.status,
      stage: webhookLogs.stage,
      error: webhookLogs.error,
      retryCount: webhookLogs.retryCount,
      processingTimeMs: webhookLogs.processingTimeMs,
      webhookLatencyMs: webhookLogs.webhookLatencyMs,
      leadId: webhookLogs.leadId,
      formId: webhookLogs.formId,
      createdAt: webhookLogs.createdAt,
      sourceName: leadSources.pageName,
      formName: leadForms.formName,
    })
    .from(webhookLogs)
    .leftJoin(leadSources, eq(webhookLogs.sourceId, leadSources.id))
    .leftJoin(leadForms, and(eq(webhookLogs.sourceId, leadForms.sourceId), eq(webhookLogs.formId, leadForms.formId)))
    .where(eq(webhookLogs.companyId, session.companyId))
    .orderBy(desc(webhookLogs.createdAt))
    .limit(200);

  return NextResponse.json({ logs: rows });
}
