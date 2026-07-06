import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";
import { lockAgent, unlockAgent } from "@/lib/supervisor";

// Supervisor Command Center: lock / unlock an agent (Part 3). A locked
// agent is excluded from auto-assignment entirely (see assignment.ts)
// until unlocked — e.g. to pull someone out of rotation for a one-off
// issue without deactivating their account.
export async function POST(req: NextRequest) {
  const auth = await requirePermission("leads:supervise");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json();
  const { userId, locked } = body;
  if (typeof userId !== "string" || typeof locked !== "boolean") {
    return NextResponse.json({ error: "userId and locked (boolean) are required." }, { status: 400 });
  }

  const updated = locked
    ? await lockAgent(userId, session.companyId, session.userId)
    : await unlockAgent(userId, session.companyId, session.userId);

  if (!updated) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

  return NextResponse.json({ ok: true, locked: updated.locked });
}
