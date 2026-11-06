import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, esignErrorResponse, remindSigner } from "@/lib/esign";
import { isUuid } from "@/lib/url";

// { signerId } → re-send that signer's link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(id) || !isUuid(body?.signerId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const res = await remindSigner(auth.session.companyId, auth.session.userId, id, body.signerId);
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.reason || "Email could not be sent" }, { status: 502 });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
