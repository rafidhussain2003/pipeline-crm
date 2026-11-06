import { NextRequest, NextResponse } from "next/server";
import { requireEsignAdmin, getFile } from "@/lib/esign";
import { db } from "@/db";
import { esignDocuments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isUuid } from "@/lib/url";

// The file PDF for the admin (inline for the editor/viewer, or download with ?download=1).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEsignAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [doc] = await db.select({ title: esignDocuments.title }).from(esignDocuments).where(and(eq(esignDocuments.id, id), eq(esignDocuments.companyId, auth.session.companyId))).limit(1);
  const bytes = doc ? await getFile(auth.session.companyId, id, "original") : null;
  if (!doc || !bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const name = `${doc.title.replace(/[^\w.-]+/g, "_")}.pdf`;
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
