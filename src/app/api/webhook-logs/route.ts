import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookLogs, leadSources, leadForms } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { resolveSourceName } from "@/lib/leads/source-privacy";

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
      sourceAlias: leadSources.agentDisplayName,
      formName: leadForms.formName,
      formAlias: leadForms.agentDisplayName,
    })
    .from(webhookLogs)
    .leftJoin(leadSources, eq(webhookLogs.sourceId, leadSources.id))
    .leftJoin(leadForms, and(eq(webhookLogs.sourceId, leadForms.sourceId), eq(webhookLogs.formId, leadForms.formId)))
    .where(eq(webhookLogs.companyId, session.companyId))
    .orderBy(desc(webhookLogs.createdAt))
    .limit(200);

  // Phase 3 — the Delivery Log is visible to EVERY role, so the real campaign
  // name is resolved away here rather than in the page. Resolving server-side
  // means the actual name never reaches an agent's browser at all, so it cannot
  // be recovered from devtools or a cached response. The alias columns were
  // fetched in the same query above — no extra round trip, no N+1.
  const logs = rows.map(({ sourceAlias, formAlias, ...row }) => ({
    ...row,
    sourceName: resolveSourceName(session.role, row.sourceName, sourceAlias),
    formName: resolveSourceName(session.role, row.formName, formAlias),
  }));

  return NextResponse.json({ logs });
}
