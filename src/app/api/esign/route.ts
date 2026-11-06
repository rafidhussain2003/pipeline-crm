import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, esignErrorResponse, listDocuments, createDocument, MAX_PDF_BYTES } from "@/lib/esign";

// E-Sign (admin only). GET lists documents; POST uploads a PDF (multipart:
// file, title) and creates a draft.
export async function GET() {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ documents: await listDocuments(auth.session.companyId) });
}

export async function POST(req: NextRequest) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return NextResponse.json({ error: "Choose a PDF file to upload" }, { status: 400 });
    if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: "PDF must be 15 MB or smaller" }, { status: 413 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const doc = await createDocument(auth.session.companyId, auth.session.userId, { title: String(form.get("title") ?? ""), fileName: file.name || "document.pdf", bytes });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
