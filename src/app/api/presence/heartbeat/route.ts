import { NextRequest, NextResponse } from "next/server";
import { requireCompanySession } from "@/lib/auth";
import { checkPolicy } from "@/lib/rate-limit";
import { recordHeartbeat, type PresenceStatus } from "@/lib/presence";
import { kickCompanySweep } from "@/lib/assignment-queue";

// The full set of client-reportable states. "offline" is included because
// navigator.sendBeacon() (the best-effort "tab is closing" signal — see the
// heartbeat hook) can only ever POST, so "going offline now" is a POST here
// with status:"offline", not a separate DELETE. "locked" can be reported by
// the browser's Idle Detection API where available; where it isn't, a
// locked machine simply stops heartbeating and the timeout catches it.
// "disconnected"/"heartbeat_lost" are NOT here — they are derived from
// staleness server-side, never self-reported (a disconnected client can't
// report anything).
const VALID_STATUSES: PresenceStatus[] = [
  "online",
  "idle",
  "busy",
  "break",
  "offline",
  "away",
  "lunch",
  "wrap_up",
  "locked",
];

// Called by the browser every ~30s while the CRM tab is open. A missing/late
// heartbeat is what marks an agent unavailable (see isAgentAvailable) — there
// is no server-initiated "you're offline now" push. When THIS heartbeat
// transitions the agent from ineligible back to eligible (came online, ended
// lunch, recovered from a stale heartbeat), it fire-and-forget kicks the
// company's queued-lead sweep so any leads that piled up while every agent
// was away flow to this agent immediately — the manager-independence
// guarantee, with /api/cron/assign-queued as the scheduled backstop.
export async function POST(req: NextRequest) {
  const auth = await requireCompanySession();
  if (!auth.ok) return auth.response;

  // Generous limit: a 30s heartbeat interval is ~2/min per agent, this just
  // guards against a misbehaving client hammering the endpoint.
  const rl = checkPolicy("api.authenticated", auth.session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const status = VALID_STATUSES.includes(body.status) ? (body.status as PresenceStatus) : "online";

  const { becameAvailable, companyId } = await recordHeartbeat(auth.session.userId, status);
  if (becameAvailable && companyId) {
    kickCompanySweep(companyId);
  }

  return NextResponse.json({ ok: true, status });
}
