import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, esignErrorResponse, setSigners } from "@/lib/esign";
import { isUuid } from "@/lib/url";

// Replace the signer list of a draft: [{ id?, name, email }].
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const signers = await setSigners(auth.session.companyId, auth.session.userId, id, Array.isArray(body?.signers) ? body.signers : []);
    return NextResponse.json({ signers: signers.map((s) => ({ ...s, token: undefined, signatureData: undefined, initialsData: undefined })) });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
