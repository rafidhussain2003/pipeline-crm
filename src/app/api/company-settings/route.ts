import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { cache } from "@/lib/infra/cache";
import {
  clampAgentLeadCap,
  agentLeadCapCacheKey,
  MIN_AGENT_LEAD_CAP,
  MAX_AGENT_LEAD_CAP,
} from "@/lib/leads/visibility-limit";

// Profile > Company tab. Read is available to any company member (agents
// can see their company's info, e.g. support email, on their own profile
// page) — only PATCH is admin-gated, per "agents should only edit their
// own profile information."
export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [company] = await db
    .select({
      name: companies.name,
      logoUrl: companies.logoUrl,
      website: companies.website,
      address: companies.address,
      timezone: companies.timezone,
      supportEmail: companies.supportEmail,
      businessPhone: companies.businessPhone,
      // Manager Privacy Mode — read by the admin Company settings toggle.
      managerPrivacyMode: companies.managerPrivacyMode,
      // Agent lead-visibility limit — null when the company uses the default.
      agentLeadVisibilityLimit: companies.agentLeadVisibilityLimit,
      // Secure Notepad — company toggle + when the Friday cleanup last ran.
      notepadEnabled: companies.notepadEnabled,
      notepadCleanupAt: companies.notepadCleanupAt,
      // Whether agents are required to set a login PIN.
      requireAgentPin: companies.requireAgentPin,
    })
    .from(companies)
    .where(eq(companies.id, session.companyId))
    .limit(1);

  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ company });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(req: NextRequest) {
  const auth = await requirePermission("company_settings:edit");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.admin", session.userId);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  const body = await req.json();

  if ("name" in body && (typeof body.name !== "string" || !body.name.trim())) {
    return NextResponse.json({ error: "Company name cannot be empty." }, { status: 400 });
  }
  if ("supportEmail" in body && body.supportEmail && !EMAIL_RE.test(body.supportEmail)) {
    return NextResponse.json({ error: "Support email is not a valid email address." }, { status: 400 });
  }

  const allowed: Record<string, unknown> = {};
  for (const key of ["name", "logoUrl", "website", "address", "timezone", "supportEmail", "businessPhone"]) {
    if (key in body) allowed[key] = body[key] || null;
  }
  // Manager Privacy Mode — a boolean, so it can't go through the `|| null`
  // loop above (false would become null). Admin-only (this whole PATCH is
  // gated by company_settings:edit) — managers/distributors can never reach it.
  if (typeof body.managerPrivacyMode === "boolean") allowed.managerPrivacyMode = body.managerPrivacyMode;
  // Secure Notepad toggle — admin-only (this whole PATCH is company_settings:edit).
  if (typeof body.notepadEnabled === "boolean") allowed.notepadEnabled = body.notepadEnabled;
  // Require agents to set a login PIN — admin-only (same gate).
  if (typeof body.requireAgentPin === "boolean") allowed.requireAgentPin = body.requireAgentPin;
  // Agent lead-visibility limit — admin-only (same gate). null resets to the
  // built-in default; a number must be within the guardrails (a raw out-of-
  // range value is rejected rather than silently clamped, so the admin sees
  // what happened). Any other type is ignored — a partial PATCH must not wipe it.
  if ("agentLeadVisibilityLimit" in body) {
    const raw = body.agentLeadVisibilityLimit;
    if (raw === null || raw === "") {
      allowed.agentLeadVisibilityLimit = null;
    } else {
      const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      if (!Number.isFinite(n) || n < MIN_AGENT_LEAD_CAP || n > MAX_AGENT_LEAD_CAP) {
        return NextResponse.json(
          { error: `Agent lead visibility limit must be a number between ${MIN_AGENT_LEAD_CAP} and ${MAX_AGENT_LEAD_CAP}, or blank for the default.` },
          { status: 400 }
        );
      }
      allowed.agentLeadVisibilityLimit = clampAgentLeadCap(n);
    }
  }
  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }
  allowed.updatedAt = new Date();

  const [beforeRow] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);

  const [updated] = await db
    .update(companies)
    .set(allowed)
    .where(eq(companies.id, session.companyId))
    .returning();

  // If Manager Privacy Mode changed, invalidate its cache so masking flips for
  // the Lead Distribution Manager immediately, not after the 30s TTL.
  if ("managerPrivacyMode" in allowed) await cache.delete(`manager-privacy-mode:${session.companyId}`);
  // Same for the agent lead-visibility cap — flip it for agents immediately.
  if ("agentLeadVisibilityLimit" in allowed) await cache.delete(agentLeadCapCacheKey(session.companyId));

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "company_settings.updated",
    entityType: "company",
    entityId: session.companyId,
    before: beforeRow
      ? {
          name: beforeRow.name,
          logoUrl: beforeRow.logoUrl,
          website: beforeRow.website,
          address: beforeRow.address,
          timezone: beforeRow.timezone,
          supportEmail: beforeRow.supportEmail,
          businessPhone: beforeRow.businessPhone,
          agentLeadVisibilityLimit: beforeRow.agentLeadVisibilityLimit,
        }
      : null,
    after: {
      name: updated.name,
      logoUrl: updated.logoUrl,
      website: updated.website,
      address: updated.address,
      timezone: updated.timezone,
      supportEmail: updated.supportEmail,
      businessPhone: updated.businessPhone,
      agentLeadVisibilityLimit: updated.agentLeadVisibilityLimit,
    },
  });

  return NextResponse.json({
    company: {
      name: updated.name,
      logoUrl: updated.logoUrl,
      website: updated.website,
      address: updated.address,
      timezone: updated.timezone,
      supportEmail: updated.supportEmail,
      businessPhone: updated.businessPhone,
    },
  });
}
