import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookLogs, leadSources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: webhookLogs.id,
      status: webhookLogs.status,
      error: webhookLogs.error,
      retryCount: webhookLogs.retryCount,
      createdAt: webhookLogs.createdAt,
      sourceName: leadSources.pageName,
    })
    .from(webhookLogs)
    .leftJoin(leadSources, eq(webhookLogs.sourceId, leadSources.id))
    .where(eq(webhookLogs.companyId, session.companyId))
    .orderBy(desc(webhookLogs.createdAt))
    .limit(100);

  return NextResponse.json({ logs: rows });
}
