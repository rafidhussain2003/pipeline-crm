import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { deletePixelConfig } from "@/lib/capi";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.companyId || (session.role !== "admin" && session.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const ok = await deletePixelConfig(id, session.companyId);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "capi.pixel_disconnected", entityType: "capi_pixel", entityId: id });
  return NextResponse.json({ ok: true });
}
