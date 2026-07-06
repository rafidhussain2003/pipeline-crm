import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, assignmentLog, auditLog, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, desc } from "drizzle-orm";

// Lead lifecycle timeline (Part 4) — merges assignment_log (routing
// decisions) and audit_log (disposition changes, notes, attachments,
// deletes, recycles — anything else already recorded via recordAudit)
// into one chronological feed. No new table: every event here was already
// being written by existing code paths, just not read back as one view.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.companyId, session.companyId)))
    .limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [assignments, auditEntries] = await Promise.all([
    db
      .select({
        id: assignmentLog.id,
        agentName: users.name,
        ruleUsed: assignmentLog.ruleUsed,
        assignedAt: assignmentLog.assignedAt,
      })
      .from(assignmentLog)
      .leftJoin(users, eq(assignmentLog.assignedTo, users.id))
      .where(eq(assignmentLog.leadId, id))
      .orderBy(desc(assignmentLog.assignedAt)),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
        userName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(and(eq(auditLog.companyId, session.companyId), eq(auditLog.entityType, "lead"), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.createdAt)),
  ]);

  const events = [
    ...assignments.map((a) => ({
      id: `assignment:${a.id}`,
      at: a.assignedAt,
      label: a.agentName ? `Assigned to ${a.agentName}` : "Assigned",
      detail: a.ruleUsed,
      actor: null as string | null,
    })),
    ...auditEntries.map((e) => ({
      id: `audit:${e.id}`,
      at: e.createdAt,
      label: e.action,
      detail: e.metadata ? JSON.stringify(e.metadata) : null,
      actor: e.userName,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return NextResponse.json({ events });
}
