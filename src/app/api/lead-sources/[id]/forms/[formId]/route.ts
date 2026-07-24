import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leadForms } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

// Toggle a single already-connected form on/off without a full reconnect —
// "Enable/Disable forms" on the Lead Sources page's connection detail
// panel. The webhook receiver only acts on forms with enabled=true (see
// api/webhooks/facebook/route.ts), so disabling a form here takes effect
// on the very next lead Facebook sends for it, with no other change needed.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; formId: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can manage lead forms" }, { status: 403 });
  }
  const { id, formId } = await params;
  const body = await req.json().catch(() => ({}));
  const hasEnabled = typeof body.enabled === "boolean";
  const hasDisplayName = "agentDisplayName" in body;
  if (!hasEnabled && !hasDisplayName) {
    return NextResponse.json({ error: "Provide enabled (boolean) and/or agentDisplayName (string)." }, { status: 400 });
  }

  const [source] = await db
    .select({ id: leadSources.id })
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Load the current form (tenant-verified above) — needed to re-initialize a
  // cleared display name back to the real form name (a form must never be left
  // with a blank/generic agent label once it has a real name).
  const [current] = await db
    .select({ id: leadForms.id, formId: leadForms.formId, formName: leadForms.formName, agentDisplayName: leadForms.agentDisplayName })
    .from(leadForms)
    .where(and(eq(leadForms.id, formId), eq(leadForms.sourceId, id)))
    .limit(1);
  if (!current) return NextResponse.json({ error: "Form not found on this source" }, { status: 404 });

  const set: { enabled?: boolean; agentDisplayName?: string | null } = {};
  if (hasEnabled) set.enabled = body.enabled;
  if (hasDisplayName) {
    // Display Name is the agent-facing alias. Clearing it re-initializes to the
    // actual form name rather than nulling it, so agents keep seeing a concrete
    // label (never the generic fallback) for an already-named form.
    const trimmed = typeof body.agentDisplayName === "string" ? body.agentDisplayName.trim().slice(0, 255) : "";
    set.agentDisplayName = trimmed || current.formName;
  }

  const [form] = await db
    .update(leadForms)
    .set(set)
    .where(and(eq(leadForms.id, formId), eq(leadForms.sourceId, id)))
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: hasDisplayName ? "lead_form.display_name_changed" : body.enabled ? "lead_form.enabled" : "lead_form.disabled",
    entityType: "lead_source",
    entityId: id,
    metadata: {
      formId: form.formId,
      formName: form.formName,
      ...(hasDisplayName ? { from: current.agentDisplayName, to: form.agentDisplayName } : {}),
    },
  });

  return NextResponse.json({ form });
}
