import { NextResponse } from "next/server";
import { db } from "@/db";
import { connectedAccounts, leadSources, leadForms, leads, webhookLogs } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull, inArray, gte, sql, desc } from "drizzle-orm";
import { resolveDateRange } from "@/lib/analytics/range";

// Backs the "Lead Delivery Health" panel on the Lead Sources page —
// everything a customer needs to answer "is this account actually
// delivering leads right now" without reading server logs. Aggregated
// across every Page under the account, since that's the unit a customer
// thinks in ("is my Meta account working"), not a single Page.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [account] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.id, id), eq(connectedAccounts.companyId, session.companyId), isNull(connectedAccounts.deletedAt)))
    .limit(1);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sources = await db
    .select({ id: leadSources.id, status: leadSources.status, webhookStatus: leadSources.webhookStatus, lastSyncedAt: leadSources.lastSyncedAt })
    .from(leadSources)
    .where(and(eq(leadSources.accountId, id), isNull(leadSources.deletedAt)));

  const sourceIds = sources.map((s) => s.id);
  if (sourceIds.length === 0) {
    return NextResponse.json({
      connectionStatus: account.status,
      deliveryStatus: "inactive",
      lastDeliveryReceivedAt: null,
      lastLeadReceivedAt: null,
      lastSuccessfulSyncAt: null,
      totalFormsConnected: 0,
      totalLeadsReceived: 0,
      leadsToday: 0,
      leadsThisWeek: 0,
      leadsThisMonth: 0,
    });
  }

  const todayRange = resolveDateRange("today");
  const weekRange = resolveDateRange("week");
  const monthRange = resolveDateRange("month");

  const [
    formsCountRow,
    totalLeadsRow,
    todayLeadsRow,
    weekLeadsRow,
    monthLeadsRow,
    lastLeadRow,
    lastDeliveryRow,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(leadForms).where(inArray(leadForms.sourceId, sourceIds)),
    db.select({ count: sql<number>`count(*)::int` }).from(leads).where(and(inArray(leads.sourceId, sourceIds), isNull(leads.deletedAt))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(inArray(leads.sourceId, sourceIds), isNull(leads.deletedAt), gte(leads.createdAt, todayRange.from))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(inArray(leads.sourceId, sourceIds), isNull(leads.deletedAt), gte(leads.createdAt, weekRange.from))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(inArray(leads.sourceId, sourceIds), isNull(leads.deletedAt), gte(leads.createdAt, monthRange.from))),
    db
      .select({ createdAt: leads.createdAt })
      .from(leads)
      .where(and(inArray(leads.sourceId, sourceIds), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt))
      .limit(1),
    db
      .select({ createdAt: webhookLogs.createdAt })
      .from(webhookLogs)
      .where(inArray(webhookLogs.sourceId, sourceIds))
      .orderBy(desc(webhookLogs.createdAt))
      .limit(1),
  ]);

  const lastSuccessfulSyncAt = sources.reduce<Date | null>((latest, s) => {
    if (!s.lastSyncedAt) return latest;
    return !latest || s.lastSyncedAt > latest ? s.lastSyncedAt : latest;
  }, null);

  return NextResponse.json({
    connectionStatus: account.status,
    deliveryStatus: sources.some((s) => s.webhookStatus === "active") ? "active" : "inactive",
    lastDeliveryReceivedAt: lastDeliveryRow[0]?.createdAt ?? null,
    lastLeadReceivedAt: lastLeadRow[0]?.createdAt ?? null,
    lastSuccessfulSyncAt,
    totalFormsConnected: formsCountRow[0]?.count ?? 0,
    totalLeadsReceived: totalLeadsRow[0]?.count ?? 0,
    leadsToday: todayLeadsRow[0]?.count ?? 0,
    leadsThisWeek: weekLeadsRow[0]?.count ?? 0,
    leadsThisMonth: monthLeadsRow[0]?.count ?? 0,
  });
}
