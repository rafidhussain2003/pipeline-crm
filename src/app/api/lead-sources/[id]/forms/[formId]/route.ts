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
  const { enabled } = await req.json();
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

  const [source] = await db
    .select({ id: leadSources.id })
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [form] = await db
    .update(leadForms)
    .set({ enabled })
    .where(and(eq(leadForms.id, formId), eq(leadForms.sourceId, id)))
    .returning();
  if (!form) return NextResponse.json({ error: "Form not found on this source" }, { status: 404 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: enabled ? "lead_form.enabled" : "lead_form.disabled",
    entityType: "lead_source",
    entityId: id,
    metadata: { formId: form.formId, formName: form.formName },
  });

  return NextResponse.json({ form });
}
