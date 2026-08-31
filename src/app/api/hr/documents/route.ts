import { NextRequest, NextResponse } from "next/server";
import { requireHR, hrErrorResponse } from "@/lib/hr/guard";
import { addDocument, addDocumentFile, listDocuments } from "@/lib/hr";

// Employee documents. ?employeeId= required for GET. POST accepts either a
// multipart/form-data file upload (stored in Postgres) or a JSON metadata row
// with an external `reference` (back-compat).
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
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
      const bytes = Buffer.from(await file.arrayBuffer());
      const document = await addDocumentFile(auth.session.companyId, auth.session.userId, {
        employeeId: String(form.get("employeeId") ?? ""),
        type: String(form.get("type") ?? ""),
        title: String(form.get("title") ?? "").trim() || file.name || "Document",
        notes: (form.get("notes") as string) || null,
        fileName: file.name || "upload",
        mimeType: file.type || "application/octet-stream",
        bytes,
      });
      return NextResponse.json({ document }, { status: 201 });
    }
    const b = await req.json().catch(() => ({}));
    const document = await addDocument(auth.session.companyId, auth.session.userId, {
      employeeId: String(b?.employeeId ?? ""),
      type: String(b?.type ?? ""),
      title: String(b?.title ?? ""),
      reference: b?.reference || null,
      notes: b?.notes || null,
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    return hrErrorResponse(err);
  }
}
