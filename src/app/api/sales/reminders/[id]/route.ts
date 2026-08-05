import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { salesReminders } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSales, resolveSalesScope } from "@/lib/sales/access";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/url";

// "Reminder Done" (and Dismiss). Marks a reminder completed/dismissed so it
// drops off the dashboard; admins see the completion history. Tenant-scoped and
// role-scoped: an agent can only act on their OWN reminders; admin/manager on
// any in their company. Audited.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const status = body?.status;
  if (status !== "completed" && status !== "dismissed") {
    return NextResponse.json({ error: "status must be 'completed' or 'dismissed'." }, { status: 400 });
  }

  // viewAll (admin/manager) may act on any reminder in the company; an agent is
  // scoped to their own. The month arg is irrelevant to this scope check.
  const scope = await resolveSalesScope(session, "0000-00");
  const [rem] = await db
    .select()
    .from(salesReminders)
    .where(
      and(
        eq(salesReminders.id, id),
        eq(salesReminders.companyId, session.companyId),
        ...(scope.viewAll ? [] : [eq(salesReminders.agentId, session.userId)])
      )
    )
    .limit(1);
  if (!rem) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Idempotent: already resolved → just report success, nothing to change.
  if (rem.status !== "pending") return NextResponse.json({ reminder: rem });

  const [updated] = await db
    .update(salesReminders)
    .set({
      status,
      completedAt: status === "completed" ? new Date() : null,
      completedBy: status === "completed" ? session.userId : null,
      updatedAt: new Date(),
    })
    .where(eq(salesReminders.id, id))
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: status === "completed" ? "sale.reminder_completed" : "sale.reminder_dismissed",
    entityType: "sale_reminder",
    entityId: id,
    metadata: { saleId: rem.saleId, kind: rem.kind, agentId: rem.agentId },
  });

  return NextResponse.json({ reminder: updated });
}
