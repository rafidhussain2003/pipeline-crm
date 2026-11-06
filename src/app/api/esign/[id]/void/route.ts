import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, esignErrorResponse, voidDocument, getDocument } from "@/lib/esign";
import { isUuid } from "@/lib/url";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    await voidDocument(auth.session.companyId, auth.session.userId, id, typeof body?.reason === "string" ? body.reason : null);
    return NextResponse.json(await getDocument(auth.session.companyId, id));
  } catch (err) {
    return esignErrorResponse(err);
  }
}
