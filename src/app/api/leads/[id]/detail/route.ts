import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users, leadSources, leadForms, webhookLogs, callbacks } from "@/db/schema";
import { getSession, type CompanySession } from "@/lib/auth";
import { leadVisibilityConditions } from "@/lib/leads/access";
import { resolveSourceName } from "@/lib/leads/source-privacy";
import { computeFollowUp } from "@/lib/followup/engine";
import { isUuid } from "@/lib/url";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // A malformed id would otherwise reach a uuid column and surface as an
  // empty-bodied 500; treat it as the missing record it describes.
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [lead] = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      state: leads.state,
      disposition: leads.disposition,
      ownerId: leads.ownerId,
      ownerName: users.name,
      followUpAt: leads.followUpAt,
      priority: leads.priority,
      isBlacklisted: leads.isBlacklisted,
      isDuplicate: leads.isDuplicate,
      duplicateOfLeadId: leads.duplicateOfLeadId,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      sourceId: leads.sourceId,
      // Lead Workspace: raw names come out of the query; what the caller
      // SEES is resolved below through the privacy layer — never returned raw.
      sourcePageName: leadSources.pageName,
      sourceAlias: leadSources.agentDisplayName,
      sourcePlatform: leadSources.platform,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    // Agent Portal: leadVisibilityConditions scopes agents to their own
    // leads — another agent's lead 404s exactly like a nonexistent one.
    .where(and(eq(leads.id, id), ...leadVisibilityConditions(session as CompanySession), isNull(leads.deletedAt)))
    .limit(1);

  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Follow-up engine input: the earliest still-open callback (indexed on
  // leadId). One small query; the engine itself is pure computation.
  const [openCallback] = await db
    .select({ scheduledAt: callbacks.scheduledAt, priority: callbacks.priority, reason: callbacks.reason })
    .from(callbacks)
    .where(and(eq(callbacks.leadId, id), eq(callbacks.companyId, session.companyId), inArray(callbacks.status, ["scheduled", "due", "missed"])))
    .orderBy(asc(callbacks.scheduledAt))
    .limit(1);

  const followUp = computeFollowUp(
    {
      disposition: lead.disposition,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      followUpAt: lead.followUpAt,
      priority: lead.priority,
    },
    openCallback ?? null
  );

  // Facebook form (Lead Workspace left panel). The lead row doesn't carry a
  // form id — the delivery log does. One indexed lookup, only for
  // provider-sourced leads; best-effort (a lead without a delivery row simply
  // shows no form).
  let formName: string | null = null;
  if (lead.sourceId) {
    const [delivery] = await db
      .select({ formName: leadForms.formName, formAlias: leadForms.agentDisplayName })
      .from(webhookLogs)
      .innerJoin(leadForms, and(eq(leadForms.sourceId, webhookLogs.sourceId), eq(leadForms.formId, webhookLogs.formId)))
      .where(and(eq(webhookLogs.leadId, id), isNotNull(webhookLogs.formId)))
      .limit(1);
    if (delivery) formName = resolveSourceName(session.role, delivery.formName, delivery.formAlias);
  }

  const { sourcePageName, sourceAlias, sourceId, ...rest } = lead;
  void sourceId;
  return NextResponse.json({
    lead: {
      ...rest,
      // Lead Privacy: agents get the alias, admins/managers the real name —
      // same single resolution rule as every other surface.
      sourceName: resolveSourceName(session.role, sourcePageName, sourceAlias),
      formName,
    },
    // The follow-up engine's verdict — Next Action / Due / Priority for the
    // workspace card. Computed here so the page needs no extra API call.
    followUp,
    // Saves the workspace a separate /api/me round trip for its role-gated
    // controls (Assign button, note Edit buttons). The server re-checks
    // permissions on every action regardless.
    viewerRole: session.role,
    viewerUserId: session.userId,
  });
}
