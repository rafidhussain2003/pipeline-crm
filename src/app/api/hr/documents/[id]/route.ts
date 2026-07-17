import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { deleteDocument } from "@/lib/hr";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    await deleteDocument(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
