import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { salesPeriodSettings } from "@/db/schema";
import { requireSales, resolveSalesScope } from "@/lib/sales/access";
import { isValidSaleMonth } from "@/lib/sales/types";
import { getPeriodSetting, invalidatePeriodSetting } from "@/lib/sales/periods";
import { recordAudit } from "@/lib/audit";

// Read a month's agent-visibility cutoff (for the admin control to show current value).
export async function GET(req: NextRequest) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const month = req.nextUrl.searchParams.get("month");
  if (!isValidSaleMonth(month)) return NextResponse.json({ error: "A valid month (YYYY-MM) is required." }, { status: 400 });
  const { agentVisibleUntilMs } = await getPeriodSetting(auth.session.companyId, month);
  return NextResponse.json({ month, agentVisibleUntil: agentVisibleUntilMs ? new Date(agentVisibleUntilMs).toISOString() : null });
}

// Set (or clear) the date after which AGENTS see this month as summary only.
// Admin only — this is the payroll/incentives privacy control.
export async function PATCH(req: NextRequest) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const scope = await resolveSalesScope(session, "0000-00");
  if (!scope.canManage) return NextResponse.json({ error: "Only an admin can change agent visibility." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const month = body?.month;
  if (!isValidSaleMonth(month)) return NextResponse.json({ error: "A valid month (YYYY-MM) is required." }, { status: 400 });

  let visibleUntil: Date | null = null;
  if (body?.agentVisibleUntil !== null && body?.agentVisibleUntil !== undefined) {
    const d = new Date(body.agentVisibleUntil);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    visibleUntil = d;
  }

  await db
    .insert(salesPeriodSettings)
    .values({ companyId: session.companyId, month, agentVisibleUntil: visibleUntil, updatedBy: session.userId })
    .onConflictDoUpdate({
      target: [salesPeriodSettings.companyId, salesPeriodSettings.month],
      set: { agentVisibleUntil: visibleUntil, updatedBy: session.userId, updatedAt: new Date() },
    });
  await invalidatePeriodSetting(session.companyId, month);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "sale.period_visibility_updated",
    entityType: "sales_period",
    entityId: month,
    after: { month, agentVisibleUntil: visibleUntil ? visibleUntil.toISOString() : null },
  });
  return NextResponse.json({ ok: true, month, agentVisibleUntil: visibleUntil ? visibleUntil.toISOString() : null });
}
