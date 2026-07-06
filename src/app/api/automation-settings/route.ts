import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { automationSettings } from "@/db/schema";
import { requirePermission } from "@/lib/permissions";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { cache } from "@/lib/infra/cache";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [settings] = await db.select().from(automationSettings).where(eq(automationSettings.companyId, session.companyId)).limit(1);
  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest) {
  // Required permission: automation_settings:edit (admin only today).
  const auth = await requirePermission("automation_settings:edit");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const body = await req.json();
  const allowed: Record<string, unknown> = {};
  for (const key of [
    "autoAssignEnabled",
    "assignmentMode",
    "autoRecycleEnabled",
    "recycleAfterMinutes",
    // Workforce/routing settings added for intelligent lead routing —
    // heartbeatTimeoutSeconds, working hours, and workload cap are all
    // nullable/defaulted (see schema.ts), so omitting them here in a
    // request keeps a company's existing behavior unchanged.
    "heartbeatTimeoutSeconds",
    "workingHoursStart",
    "workingHoursEnd",
    "maxOpenLeadsPerAgent",
    "maxRecycleCount",
  ]) {
    if (key in body) allowed[key] = body[key];
  }

  const [beforeRow] = await db.select().from(automationSettings).where(eq(automationSettings.companyId, session.companyId)).limit(1);

  // A handful of these values can silently stop assignment company-wide if
  // misconfigured (e.g. a zero-width working-hours window makes
  // isWithinWorkingHours() false 24/7 — see assignment.ts) — reject the
  // nonsensical cases here rather than let an admin accidentally lock
  // their own company out of auto-assignment with a typo.
  const effectiveStart = "workingHoursStart" in allowed ? allowed.workingHoursStart : beforeRow?.workingHoursStart ?? null;
  const effectiveEnd = "workingHoursEnd" in allowed ? allowed.workingHoursEnd : beforeRow?.workingHoursEnd ?? null;
  if (
    ("recycleAfterMinutes" in allowed && (typeof allowed.recycleAfterMinutes !== "number" || allowed.recycleAfterMinutes < 1)) ||
    ("heartbeatTimeoutSeconds" in allowed && (typeof allowed.heartbeatTimeoutSeconds !== "number" || allowed.heartbeatTimeoutSeconds < 10)) ||
    ("maxRecycleCount" in allowed && (typeof allowed.maxRecycleCount !== "number" || allowed.maxRecycleCount < 0)) ||
    ("maxOpenLeadsPerAgent" in allowed && allowed.maxOpenLeadsPerAgent !== null && (typeof allowed.maxOpenLeadsPerAgent !== "number" || allowed.maxOpenLeadsPerAgent < 1)) ||
    (effectiveStart != null && (typeof effectiveStart !== "number" || effectiveStart < 0 || effectiveStart > 1439)) ||
    (effectiveEnd != null && (typeof effectiveEnd !== "number" || effectiveEnd < 0 || effectiveEnd > 1439)) ||
    (effectiveStart != null && effectiveEnd != null && effectiveStart === effectiveEnd)
  ) {
    return NextResponse.json(
      { error: "Invalid automation settings. Check working hours (can't be equal), heartbeat timeout (min 10s), and recycle/workload values (must be positive)." },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(automationSettings)
    .set(allowed)
    .where(eq(automationSettings.companyId, session.companyId))
    .returning();

  // Invalidate immediately rather than waiting out the 30s TTL — otherwise
  // a lead created right after this change could still use the old
  // settings for up to 30 seconds.
  await cache.delete(`automation-settings:${session.companyId}`);

  if (updated) {
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "automation_settings.updated",
      entityType: "automation_settings",
      entityId: updated.id,
      before: beforeRow
        ? {
            autoAssignEnabled: beforeRow.autoAssignEnabled,
            assignmentMode: beforeRow.assignmentMode,
            autoRecycleEnabled: beforeRow.autoRecycleEnabled,
            recycleAfterMinutes: beforeRow.recycleAfterMinutes,
            heartbeatTimeoutSeconds: beforeRow.heartbeatTimeoutSeconds,
            workingHoursStart: beforeRow.workingHoursStart,
            workingHoursEnd: beforeRow.workingHoursEnd,
            maxOpenLeadsPerAgent: beforeRow.maxOpenLeadsPerAgent,
            maxRecycleCount: beforeRow.maxRecycleCount,
          }
        : null,
      after: {
        autoAssignEnabled: updated.autoAssignEnabled,
        assignmentMode: updated.assignmentMode,
        autoRecycleEnabled: updated.autoRecycleEnabled,
        recycleAfterMinutes: updated.recycleAfterMinutes,
        heartbeatTimeoutSeconds: updated.heartbeatTimeoutSeconds,
        workingHoursStart: updated.workingHoursStart,
        workingHoursEnd: updated.workingHoursEnd,
        maxOpenLeadsPerAgent: updated.maxOpenLeadsPerAgent,
        maxRecycleCount: updated.maxRecycleCount,
      },
    });
  }

  return NextResponse.json({ settings: updated });
}
