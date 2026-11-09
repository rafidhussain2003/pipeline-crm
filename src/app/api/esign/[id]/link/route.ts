import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, esignErrorResponse, createShareLink, revokeShareLink } from "@/lib/esign";
import { isUuid } from "@/lib/url";

// Share link for a document (admin). POST { signerId? } generates a fresh
// 24-hour link (retiring the previous one); DELETE disables the live link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const link = await createShareLink(auth.session.companyId, auth.session.userId, id, isUuid(body?.signerId) ? body.signerId : null);
    return NextResponse.json({ shareLink: link }, { status: 201 });
  } catch (err) {
    return esignErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await revokeShareLink(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
