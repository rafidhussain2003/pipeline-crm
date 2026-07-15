import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyCode } from "@/lib/auth/verification";
import { signShortLived } from "@/lib/auth";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({ email: z.string().email(), code: z.string().min(4).max(8) });

// Step 2 of signup: verify the 6-digit code. On success, consume it and issue a
// short-lived signed token proving the email is verified — the /register step
// exchanges it (plus a chosen password) for a real account. Nothing is created
// until the password step, so an abandoned verification leaves no half-account.
export async function POST(req: NextRequest) {
  return withRoute("auth.verify-email.verify", "POST", req, async () => {
    const rl = checkPolicy("auth.signup", getClientIp(req));
    if (!rl.allowed) return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
    const { email, code } = parsed.data;

    const result = await verifyCode({ email, purpose: "signup", code });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const payload = result.payload || {};
    const token = signShortLived({ purpose: "signup", email: email.toLowerCase(), name: String(payload.name || ""), companyName: String(payload.companyName || "") }, "20m");
    return NextResponse.json({ ok: true, token });
  });
}
