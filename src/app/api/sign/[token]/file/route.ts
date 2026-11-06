import { NextRequest, NextResponse } from "next/server";
import { originalFileByToken } from "@/lib/esign";

// The original PDF for the signer page's viewer.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = await originalFileByToken(token);
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(f.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${f.title.replace(/[^\w.-]+/g, "_")}.pdf"`, "Cache-Control": "private, no-store" } });
}
