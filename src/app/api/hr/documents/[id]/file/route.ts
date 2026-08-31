import { NextRequest, NextResponse } from "next/server";
import { requireHR } from "@/lib/hr/guard";
import { getDocumentFile } from "@/lib/hr";
import { isUuid } from "@/lib/url";

// Stream a stored HR document's bytes (company-scoped) for inline preview /
// download. hr:view is enough to read — uploading/deleting needs hr:manage.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireHR("hr:view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = await getDocumentFile(auth.session.companyId, id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const safeName = file.fileName.replace(/[^A-Za-z0-9._ -]/g, "_") || "document";
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Content-Length": String(file.data.length),
      "Cache-Control": "private, no-store",
    },
  });
}
