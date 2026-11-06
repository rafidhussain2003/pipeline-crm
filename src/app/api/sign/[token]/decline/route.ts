import { NextRequest, NextResponse } from "next/server";
import { esignErrorResponse, declineDocument } from "@/lib/esign";
import { getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    await declineDocument(token, typeof body?.reason === "string" ? body.reason : null, { ip: getClientIp(req), userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
