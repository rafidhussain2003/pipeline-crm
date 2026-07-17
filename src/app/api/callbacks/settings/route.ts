import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getCallbackSettings, implementedChannels, updateCallbackSettings } from "@/lib/callbacks";

// Smart-reminder configuration. Readable by anyone in the company (the UI shows
// the sound toggle to agents); only an admin can change it.
export async function GET() {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await getCallbackSettings(session.companyId);
  return NextResponse.json({ settings, channels: implementedChannels(), editable: session.role === "admin" });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const before = await getCallbackSettings(session.companyId);
  try {
    const settings = await updateCallbackSettings(session.companyId, {
      reminderOffsets: Array.isArray(body?.reminderOffsets) ? body.reminderOffsets : undefined,
      escalateAfterMinutes: typeof body?.escalateAfterMinutes === "number" ? body.escalateAfterMinutes : undefined,
      notifyManager: typeof body?.notifyManager === "boolean" ? body.notifyManager : undefined,
      notifyAdmin: typeof body?.notifyAdmin === "boolean" ? body.notifyAdmin : undefined,
      soundEnabled: typeof body?.soundEnabled === "boolean" ? body.soundEnabled : undefined,
    });
    await recordAudit({ companyId: session.companyId, userId: session.userId, action: "callback.settings_updated", entityType: "callback_settings", entityId: session.companyId, before, after: settings });
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid settings" }, { status: 400 });
  }
}
