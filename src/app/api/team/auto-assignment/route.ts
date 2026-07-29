import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { automationSettings } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { cache } from "@/lib/infra/cache";

// The MASTER auto-assignment switch, toggleable from BOTH the admin Automation
// page and the Lead Distribution Manager's Auto Assignment console — they
// control the SAME company setting (automation_settings.autoAssignEnabled). It
// is the ONE global assignment control a distributor may flip; every other
// automation setting (mode, recycle, working hours, cooldown DURATION) stays
// admin-only on /api/automation-settings. When OFF, no automatic assignment
// happens (the pipeline's first gate); manual assignment still works.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin" && session.role !== "lead_distributor") {
    return NextResponse.json({ error: "You can't change the auto-assignment switch" }, { status: 403 });
  }
  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (typeof body?.autoAssignEnabled !== "boolean") {
    return NextResponse.json({ error: "autoAssignEnabled must be true or false" }, { status: 400 });
  }
  const autoAssignEnabled = body.autoAssignEnabled;

  const [updated] = await db
    .update(automationSettings)
    .set({ autoAssignEnabled })
    .where(eq(automationSettings.companyId, session.companyId))
    .returning({ id: automationSettings.id, autoAssignEnabled: automationSettings.autoAssignEnabled });
  if (!updated) return NextResponse.json({ error: "Automation settings not found" }, { status: 404 });

  // Same cache key the pipeline reads through — invalidate so the change takes
  // effect on the very next lead, not after the 30s TTL.
  await cache.delete(`automation-settings:${session.companyId}`);

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: autoAssignEnabled ? "automation.auto_assign_enabled" : "automation.auto_assign_disabled",
    entityType: "automation_settings",
    entityId: updated.id,
    metadata: { via: session.role === "lead_distributor" ? "manager_console" : "admin" },
  });

  return NextResponse.json({ autoAssignEnabled: updated.autoAssignEnabled });
}
