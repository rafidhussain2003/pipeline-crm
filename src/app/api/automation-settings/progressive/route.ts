import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { getProgressiveConfig, updateProgressiveConfig } from "@/lib/assignment/progressive/config";
import { getProgressiveStatus } from "@/lib/assignment/progressive/engine";

// Phase 17 — Progressive Lead Release settings. Its own sub-route (rather than
// more keys on the flat automation-settings PATCH) because the payload is a
// structured blob with its own validation, and enable/disable deserves a
// distinct audit action.
export async function GET() {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [config, status] = await Promise.all([getProgressiveConfig(session.companyId), getProgressiveStatus(session.companyId)]);
  return NextResponse.json({ config, status });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission("automation_settings:edit");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const before = await getProgressiveConfig(session.companyId);
  try {
    const config = await updateProgressiveConfig(session.companyId, {
      enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
      releaseIntervalMinutes: typeof body?.releaseIntervalMinutes === "number" ? body.releaseIntervalMinutes : undefined,
      reservedBacklogPercent: typeof body?.reservedBacklogPercent === "number" ? body.reservedBacklogPercent : undefined,
      batchSizePerTier: body?.batchSizePerTier && typeof body.batchSizePerTier === "object" ? body.batchSizePerTier : undefined,
      maxActiveLeads: body?.maxActiveLeads === null || typeof body?.maxActiveLeads === "number" ? body.maxActiveLeads : undefined,
    });

    // Enable/disable is the operationally loud change — audit it as its own
    // action so it's findable; plain tuning lands under .settings_updated.
    const action =
      before.enabled !== config.enabled
        ? config.enabled
          ? "assignment.progressive_enabled"
          : "assignment.progressive_disabled"
        : "assignment.progressive_settings_updated";
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action,
      entityType: "progressive_release",
      entityId: session.companyId,
      before,
      after: config,
    });
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid settings" }, { status: 400 });
  }
}
