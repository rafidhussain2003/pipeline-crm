import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { createDesignation, listDesignations } from "@/lib/hr";

export async function GET() {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ designations: await listDesignations(auth.session.companyId) });
}

export async function POST(req: NextRequest) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const designation = await createDesignation(auth.session.companyId, auth.session.userId, { title: String(b?.title ?? ""), code: String(b?.code ?? ""), departmentId: b?.departmentId || null, level: b?.level !== undefined ? Number(b.level) : undefined });
    return NextResponse.json({ designation }, { status: 201 });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
