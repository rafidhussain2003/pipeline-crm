import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getMappingUi, updateMappings, META_EVENTS } from "@/lib/capi";

// Event Mapping for a pixel: every CRM trigger (system + company dispositions)
// with its mapped Meta event. Admin/manager only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const mappings = await getMappingUi(id, session.companyId);
  if (!mappings) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ mappings, events: META_EVENTS });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body?.mappings) ? body.mappings : null;
  if (!rows) return NextResponse.json({ error: "mappings array required" }, { status: 400 });
  const clean = rows
    .filter((r: unknown): r is { trigger: string; metaEvent: string | null; enabled: boolean } => !!r && typeof (r as { trigger?: unknown }).trigger === "string")
    .map((r: { trigger: string; metaEvent: unknown; enabled: unknown }) => ({ trigger: r.trigger, metaEvent: typeof r.metaEvent === "string" && r.metaEvent ? r.metaEvent : null, enabled: r.enabled !== false }));
  const ok = await updateMappings(id, session.companyId, clean);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "capi.mappings_updated", entityType: "capi_pixel", entityId: id, after: { count: clean.length } });
  return NextResponse.json({ ok: true });
}
