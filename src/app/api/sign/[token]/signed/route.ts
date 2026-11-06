import { NextRequest, NextResponse } from "next/server";
import { signedFileByToken } from "@/lib/esign";

// The completed, signed PDF — available to every signer via their own link.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = await signedFileByToken(token);
  if (!f) return NextResponse.json({ error: "Not available yet" }, { status: 404 });
  return new NextResponse(new Uint8Array(f.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${f.title.replace(/[^\w.-]+/g, "_")}-signed.pdf"`, "Cache-Control": "private, no-store" } });
}
