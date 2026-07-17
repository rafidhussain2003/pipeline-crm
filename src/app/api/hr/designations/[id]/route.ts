import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { deleteDesignation, updateDesignation } from "@/lib/hr";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    const designation = await updateDesignation(auth.session.companyId, auth.session.userId, id, {
      title: typeof b?.title === "string" ? b.title : undefined,
      departmentId: b?.departmentId !== undefined ? b.departmentId || null : undefined,
      level: b?.level !== undefined ? Number(b.level) : undefined,
      active: typeof b?.active === "boolean" ? b.active : undefined,
    });
    return NextResponse.json({ designation });
  } catch (err) {
    return hrErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteDesignation(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
