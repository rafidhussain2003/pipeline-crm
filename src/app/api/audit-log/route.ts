import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can view the audit log" }, { status: 403 });
  }

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
    .where(eq(auditLog.companyId, session.companyId))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return NextResponse.json({ entries: rows });
}
