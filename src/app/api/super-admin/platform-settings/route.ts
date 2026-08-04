import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import {
  getAgentLeadVisibilityCap,
  setAgentLeadVisibilityCap,
  clampAgentLeadCap,
  DEFAULT_AGENT_LEAD_CAP,
  MIN_AGENT_LEAD_CAP,
  MAX_AGENT_LEAD_CAP,
} from "@/lib/platform/settings";

// Platform-owner global settings. Today just one knob: the agent lead-
// visibility cap (how many of their most-recently-assigned leads an agent may
// see). Global — NOT per company — so it lives here, not in the per-company
// feature routes. Super-admin only.
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const agentLeadVisibilityLimit = await getAgentLeadVisibilityCap();
  return NextResponse.json({
    agentLeadVisibilityLimit,
    defaults: {
      agentLeadVisibilityLimit: DEFAULT_AGENT_LEAD_CAP,
      min: MIN_AGENT_LEAD_CAP,
      max: MAX_AGENT_LEAD_CAP,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const raw = body?.agentLeadVisibilityLimit;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "agentLeadVisibilityLimit must be a number" }, { status: 400 });
  }
  // Reject out-of-range explicitly (rather than silently clamping) so the
  // owner sees exactly what they can set; clampAgentLeadCap still guards the
  // stored value as a backstop.
  if (n < MIN_AGENT_LEAD_CAP || n > MAX_AGENT_LEAD_CAP) {
    return NextResponse.json(
      { error: `agentLeadVisibilityLimit must be between ${MIN_AGENT_LEAD_CAP} and ${MAX_AGENT_LEAD_CAP}` },
      { status: 400 }
    );
  }

  const before = await getAgentLeadVisibilityCap();
  const stored = await setAgentLeadVisibilityCap(clampAgentLeadCap(n), auth.session.userId);

  // Platform-global change → companyId null. Audited so a cap change is never
  // silent.
  await recordAudit({
    companyId: null,
    userId: auth.session.userId,
    action: "platform_settings.updated",
    entityType: "platform_setting",
    entityId: "agent_lead_visibility_limit",
    before: { agentLeadVisibilityLimit: before },
    after: { agentLeadVisibilityLimit: stored },
  });

  return NextResponse.json({ agentLeadVisibilityLimit: stored });
}
