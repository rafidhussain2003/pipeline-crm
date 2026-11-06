import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, esignErrorResponse, setFields } from "@/lib/esign";
import { isUuid } from "@/lib/url";

// Replace all placed fields of a draft.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ fields: await setFields(auth.session.companyId, auth.session.userId, id, Array.isArray(body?.fields) ? body.fields : []) });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
