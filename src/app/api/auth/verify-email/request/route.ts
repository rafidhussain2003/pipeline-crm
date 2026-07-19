import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requestCode } from "@/lib/auth/verification";
import { sendVerificationEmail } from "@/lib/email/send";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({ name: z.string().min(2), companyName: z.string().min(2), email: z.string().email() });

// Step 1 of signup: email a 6-digit verification code (carrying the pending
// name + company). Prevents duplicate registrations; 60s resend cooldown +
// resend cap enforced in the verification lib.
export async function POST(req: NextRequest) {
  return withRoute("auth.verify-email.request", "POST", req, async (logger) => {
    const rl = checkPolicy("auth.signup", getClientIp(req));
    if (!rl.allowed) return NextResponse.json({ error: "Too many attempts. Please wait a minute and try again." }, { status: 429 });

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter your name, company, and a valid email." }, { status: 400 });
    const { name, companyName, email } = parsed.data;

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existing) return NextResponse.json({ error: "An account with that email already exists. Try signing in instead." }, { status: 409 });

    const result = await requestCode({ email, purpose: "signup", payload: { name, companyName } });
    if (!result.ok) return NextResponse.json({ error: result.error, retryAfterSec: result.retryAfterSec }, { status: 429 });

    const sent = await sendVerificationEmail(email, result.code);
    // Dev fallback: when email isn't configured, log the code so the flow is
    // still testable end-to-end from the server logs.
    // Same rule as the password-reset path: the code is a live credential and
    // is never written to the logs, only the fact that delivery failed.
    if (!sent) logger.warn("verification_email_not_sent", { email });

    return NextResponse.json({ ok: true, resend: result.resend, cooldownSec: 60 });
  });
}
