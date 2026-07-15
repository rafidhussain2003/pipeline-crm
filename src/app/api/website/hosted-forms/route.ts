import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { validateFields, createHostedForm, listHostedForms, ensureWebsiteSource } from "@/lib/website";

// Hosted form builder API (Phase 8), admin-only. A hosted form is a small
// schema stored in `hosted_forms`; it renders at the public /f/[id] page and
// submits through /api/forms/[sourceId] — i.e. the SAME ingestInboundLead
// pipeline every other source uses. This route never touches the assignment
// engine, presence, lifecycle, operations, or billing.

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const forms = await listHostedForms(session.companyId);
  return NextResponse.json({ forms });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A form name is required." }, { status: 400 });

  const fields = validateFields(body?.fields);
  if (fields.length === 0) {
    return NextResponse.json({ error: "Add at least one valid field." }, { status: 400 });
  }
  // Require at least one lead-identifying field so a submission can create a
  // lead (mirrors the SDK's lead-form heuristic).
  if (!fields.some((f) => f.type === "email" || f.type === "phone")) {
    return NextResponse.json({ error: "Include an email or phone field." }, { status: 400 });
  }

  // Reuse (or create) the company's Website connection — the form posts to it.
  const source = await ensureWebsiteSource(session.companyId, session.userId);

  const id = await createHostedForm({
    companyId: session.companyId,
    sourceId: source.id,
    name,
    fields,
    submitText: typeof body?.submitText === "string" ? body.submitText : undefined,
    successMessage: typeof body?.successMessage === "string" ? body.successMessage : null,
    redirectUrl: typeof body?.redirectUrl === "string" ? body.redirectUrl : null,
    createdBy: session.userId,
  });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "hosted_form.created",
    entityType: "hosted_form",
    entityId: id,
    after: { name, fieldCount: fields.length },
  });

  return NextResponse.json({ id, url: `/f/${id}` });
}
