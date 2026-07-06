import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { checkPolicy } from "@/lib/rate-limit";
import { recordHeartbeat, type PresenceStatus } from "@/lib/presence";

// Includes "offline" deliberately: navigator.sendBeacon() (used for the
// best-effort "tab is closing" signal — see the heartbeat hook) can only
// ever send a POST, so the "going offline now" signal has to be a POST
// here with status: "offline", not a separate DELETE endpoint.
const VALID_STATUSES: PresenceStatus[] = ["online", "idle", "busy", "break", "offline"];

// Called by the browser every ~30s while the CRM tab is open (see the
// heartbeat hook wired into the authenticated layout). A missing/late
// heartbeat is what marks an agent unavailable — see isAgentAvailable() —
// there's no separate server-initiated "you're offline now" push; if the
// beacon below never arrives (browser killed, network cut), the heartbeat
// timeout is what guarantees correctness instead.
export async function POST(req: NextRequest) {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth.response;

  // Generous limit: a 30s heartbeat interval is ~2/min per agent, this
  // just guards against a misbehaving client hammering the endpoint.
  const rl = checkPolicy("api.authenticated", auth.session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const status = VALID_STATUSES.includes(body.status) ? (body.status as PresenceStatus) : "online";

  await recordHeartbeat(auth.session.userId, status);
  return NextResponse.json({ ok: true, status });
}
