import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, esignErrorResponse, sendDocument, getDocument } from "@/lib/esign";
import { isUuid } from "@/lib/url";

// Send the draft: emails every signer their private link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await sendDocument(auth.session.companyId, auth.session.userId, id, typeof body?.message === "string" ? body.message : undefined);
    return NextResponse.json({ ...result, ...(await getDocument(auth.session.companyId, id)) });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
