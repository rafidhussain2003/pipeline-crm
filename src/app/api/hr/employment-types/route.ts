import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { createEmploymentType, listEmploymentTypes } from "@/lib/hr";

export async function GET() {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ types: await listEmploymentTypes(auth.session.companyId) });
}

export async function POST(req: NextRequest) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const type = await createEmploymentType(auth.session.companyId, auth.session.userId, { name: String(b?.name ?? ""), code: String(b?.code ?? "") });
    return NextResponse.json({ type }, { status: 201 });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
