import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/url";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";

// Paged newest-first. 50 per request; "load more" passes the last visible
// entry's (createdAt, id) as a CURSOR — not an offset — so rows arriving
// between requests can never shift the window into duplicates or gaps, and
// the query stays an indexed range scan on (company_id, created_at) no
// matter how deep the admin scrolls.
const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can view the audit log" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const beforeRaw = params.get("before");
  const beforeId = params.get("beforeId");
  const before = beforeRaw ? new Date(beforeRaw) : null;
  const cursorValid = before && !Number.isNaN(before.getTime()) && beforeId && isUuid(beforeId);

  const where = cursorValid
    ? and(
        eq(auditLog.companyId, session.companyId),
        // Strictly older than the cursor row, with id as the tiebreak for
        // entries sharing the same timestamp.
        or(lt(auditLog.createdAt, before), and(eq(auditLog.createdAt, before), sql`${auditLog.id} < ${beforeId}`))
      )
    : eq(auditLog.companyId, session.companyId);

  // Fetch one extra row purely to learn whether another page exists.
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      userName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  return NextResponse.json({ entries: rows.slice(0, PAGE_SIZE), hasMore });
}
