import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requirePermission } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/url";

// Phase 3 — set the agent-facing alias for a lead source.
//
// Only the ALIAS is writable. The real name (pageName) comes from Meta and is
// deliberately not settable here: Task 2 requires it stay read-only, and making
// it editable in the same request would let a mis-click destroy the reporting
// name this whole feature exists to protect.
//
// Gated on the existing admin-only company_settings:edit rather than a new
// permission key. Managers can SEE real names (they run reporting) but do not
// define what agents are shown — that is an administrator's decision per Task 2.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("company_settings:edit");
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const raw = body?.agentDisplayName;
  if (raw !== null && typeof raw !== "string") {
    return NextResponse.json({ error: "agentDisplayName must be a string, or null to clear it" }, { status: 400 });
  }
  const trimmed = typeof raw === "string" ? raw.trim() : null;
  if (trimmed && trimmed.length > 255) {
    return NextResponse.json({ error: "Display name must be 255 characters or fewer." }, { status: 400 });
  }
  // Empty string means "clear the alias" — stored as NULL so the fallback to
  // the real name is a single condition everywhere rather than "null or blank".
  const next = trimmed ? trimmed : null;

  const [before] = await db
    .select({ id: leadSources.id, pageName: leadSources.pageName, agentDisplayName: leadSources.agentDisplayName })
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId!), isNull(leadSources.deletedAt)))
    .limit(1);
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [updated] = await db
    .update(leadSources)
    .set({ agentDisplayName: next })
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId!)))
    .returning({ id: leadSources.id, pageName: leadSources.pageName, agentDisplayName: leadSources.agentDisplayName });

  if (before.agentDisplayName !== next) {
    await recordAudit({
      companyId: session.companyId!,
      userId: session.userId,
      action: "lead_source.display_name_updated",
      entityType: "lead_source",
      entityId: id,
      before: { agentDisplayName: before.agentDisplayName },
      after: { agentDisplayName: next },
    });
  }

  return NextResponse.json({ source: updated });
}
