import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, esignErrorResponse, getDocument, updateDocument, deleteDocument } from "@/lib/esign";
import { isUuid } from "@/lib/url";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const data = isUuid(id) ? await getDocument(auth.session.companyId, id) : null;
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const doc = await updateDocument(auth.session.companyId, auth.session.userId, id, { title: typeof body?.title === "string" ? body.title : undefined, message: body?.message !== undefined ? body.message : undefined });
    return NextResponse.json({ document: doc });
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
    await deleteDocument(auth.session.companyId, auth.session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
