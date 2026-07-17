import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { deleteDepartment, updateDepartment } from "@/lib/hr";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    const department = await updateDepartment(auth.session.companyId, auth.session.userId, id, {
      name: typeof b?.name === "string" ? b.name : undefined,
      parentId: b?.parentId !== undefined ? b.parentId || null : undefined,
      managerUserId: b?.managerUserId !== undefined ? b.managerUserId || null : undefined,
      active: typeof b?.active === "boolean" ? b.active : undefined,
    });
    return NextResponse.json({ department });
  } catch (err) {
    return hrErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteDepartment(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
