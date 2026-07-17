import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { createDepartment, listDepartments } from "@/lib/hr";

export async function GET() {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ departments: await listDepartments(auth.session.companyId) });
}

export async function POST(req: NextRequest) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const department = await createDepartment(auth.session.companyId, auth.session.userId, { name: String(b?.name ?? ""), code: String(b?.code ?? ""), parentId: b?.parentId || null, managerUserId: b?.managerUserId || null });
    return NextResponse.json({ department }, { status: 201 });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
