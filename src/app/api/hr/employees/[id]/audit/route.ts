import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireHR } from "@/lib/hr/guard";
import { isUuid } from "@/lib/url";

// Enterprise HR Workspace — an employee's audit history, straight from the
// existing audit_log (user, timestamp, previous value, new value, company —
// all already recorded by every HR mutation). hr:manage only; tenant-scoped
// by companyId in the WHERE, so another company's entries can never appear.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      actorName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(and(eq(auditLog.companyId, auth.session.companyId), eq(auditLog.entityType, "hr_employee"), eq(auditLog.entityId, id)))
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  // recordAudit stores before/after inside the metadata jsonb — unpack for
  // the card so the client never parses audit internals.
  const entries = rows.map((r) => {
    const m = (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as Record<string, unknown>;
    return {
      id: r.id,
      action: r.action,
      before: (m.before as Record<string, unknown> | undefined) ?? null,
      after: (m.after as Record<string, unknown> | undefined) ?? null,
      createdAt: r.createdAt,
      actorName: r.actorName,
    };
  });

  return NextResponse.json({ entries });
}
