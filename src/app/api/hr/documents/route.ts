import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { addDocument, listDocuments } from "@/lib/hr";

// Employee documents (metadata only). ?employeeId= required for GET.
export async function GET(req: NextRequest) {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  const employeeId = req.nextUrl.searchParams.get("employeeId");
  if (!employeeId) return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
  return NextResponse.json({ documents: await listDocuments(auth.session.companyId, employeeId) });
}

export async function POST(req: NextRequest) {
  const auth = await requireHR("hr:manage");
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  try {
    const document = await addDocument(auth.session.companyId, auth.session.userId, { employeeId: String(b?.employeeId ?? ""), type: String(b?.type ?? ""), title: String(b?.title ?? ""), reference: b?.reference || null, notes: b?.notes || null });
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
