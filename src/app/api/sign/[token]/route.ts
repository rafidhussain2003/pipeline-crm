import { NextRequest, NextResponse } from "next/server";
import { esignErrorResponse, signerView, submitSignature } from "@/lib/esign";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";

// PUBLIC signer endpoints — the 64-hex token in the link is the credential.
// GET  → the document, this signer's fields, everyone's status (marks "viewed")
// POST → { signatureData?, initialsData?, values } → sign
function meta(req: NextRequest) {
  return { ip: getClientIp(req), userAgent: req.headers.get("user-agent") };
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rl = checkPolicy("api.public", getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const view = await signerView(token, meta(req));
  if (!view) return NextResponse.json({ error: "This signing link is not valid." }, { status: 404 });
  return NextResponse.json(view);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rl = checkPolicy("api.public", getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await submitSignature(token, { signatureData: typeof body?.signatureData === "string" ? body.signatureData : null, initialsData: typeof body?.initialsData === "string" ? body.initialsData : null, values: body?.values && typeof body.values === "object" ? body.values : {} }, meta(req));
    return NextResponse.json(result);
  } catch (err) {
    return esignErrorResponse(err);
  }
}
