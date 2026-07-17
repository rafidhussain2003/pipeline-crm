import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CallbackError, cancelCallback, completeCallback, getCallbackHistory, rescheduleCallback } from "@/lib/callbacks";

// One route for every transition an agent can make on a callback. Each action
// is audited inside the service, so there is no unaudited path to change state.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";

  try {
    if (action === "reschedule") {
      if (typeof body.scheduledAt !== "string") return NextResponse.json({ error: "scheduledAt is required" }, { status: 400 });
      const callback = await rescheduleCallback(session, id, {
        scheduledAt: new Date(body.scheduledAt),
        reason: typeof body.reason === "string" ? body.reason : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        priority: typeof body.priority === "string" ? body.priority : undefined,
        timezone: typeof body.timezone === "string" ? body.timezone : undefined,
      });
      return NextResponse.json({ callback });
    }
    if (action === "complete") {
      const callback = await completeCallback(session, id, typeof body.outcome === "string" ? body.outcome : undefined);
      return NextResponse.json({ callback });
    }
    if (action === "cancel") {
      const callback = await cancelCallback(session, id, typeof body.note === "string" ? body.note : undefined);
      return NextResponse.json({ callback });
    }
    return NextResponse.json({ error: "action must be one of: reschedule, complete, cancel" }, { status: 400 });
  } catch (err) {
    if (err instanceof CallbackError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// The callback's own timeline (created → reminders → reschedules → outcome).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const history = await getCallbackHistory(id, session.companyId);
  return NextResponse.json({ history });
}
