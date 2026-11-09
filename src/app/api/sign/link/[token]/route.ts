import { NextRequest, NextResponse } from "next/server";
import { esignErrorResponse, shareLinkView, claimShareLink } from "@/lib/esign";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";

// PUBLIC share-link endpoints — no account. GET describes the document the
// link is for (or why the link can't be used); POST { name, email } creates
// the visitor's own copy and returns their private signing token.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rl = checkPolicy("api.public", getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  try {
    return NextResponse.json(await shareLinkView(token));
  } catch (err) {
    return esignErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rl = checkPolicy("api.public", getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await claimShareLink(token, { name: typeof body?.name === "string" ? body.name : "", email: typeof body?.email === "string" ? body.email : "" }, { ip: getClientIp(req), userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ...result, url: `/sign/${result.token}` }, { status: 201 });
  } catch (err) {
    return esignErrorResponse(err);
  }
}
