import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assignmentRules } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";
import { checkPolicy } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { cache } from "@/lib/infra/cache";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.select().from(assignmentRules).where(eq(assignmentRules.companyId, session.companyId));
  return NextResponse.json({ rules: rows });
}

export async function PATCH(req: NextRequest) {
  // Required permission: assignment_rules:edit (admin only today; see
  // src/lib/permissions.ts for the full role -> permission matrix).
  const auth = await requirePermission("assignment_rules:edit");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  // This changes lead routing for the whole company going forward — an
  // admin-mutating action, so it gets a tighter limit than ordinary
  // authenticated reads/writes.
  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many changes in a short time. Please slow down." }, { status: 429 });
  }

  const { tier, weight, active } = await req.json();
  if (!tier) return NextResponse.json({ error: "tier is required" }, { status: 400 });

  const [beforeRow] = await db
    .select()
    .from(assignmentRules)
    .where(and(eq(assignmentRules.companyId, session.companyId), eq(assignmentRules.tier, tier)))
    .limit(1);

  const allowed: Record<string, unknown> = {};
  if (weight !== undefined) allowed.weight = weight;
  if (active !== undefined) allowed.active = active;

  const [updated] = await db
    .update(assignmentRules)
    .set(allowed)
    .where(and(eq(assignmentRules.companyId, session.companyId), eq(assignmentRules.tier, tier)))
    .returning();

  // Invalidate immediately rather than waiting out the 30s TTL — a lead
  // assigned right after this change should use the new weights.
  await cache.delete(`assignment-rules:${session.companyId}`);

  if (updated) {
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "assignment_rule.updated",
      entityType: "assignment_rule",
      entityId: updated.id,
      before: beforeRow ? { weight: beforeRow.weight, active: beforeRow.active } : null,
      after: { weight: updated.weight, active: updated.active },
      metadata: { tier },
    });
  }

  return NextResponse.json({ rule: updated });
}
