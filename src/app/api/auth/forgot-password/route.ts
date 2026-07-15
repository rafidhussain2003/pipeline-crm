import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requestCode } from "@/lib/auth/verification";
import { sendPasswordResetEmail } from "@/lib/email/send";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { withRoute } from "@/lib/api-handler";

const schema = z.object({ email: z.string().email() });

// Password reset step 1: email a reset code IF the account exists. Always
// returns the same generic response so it can't be used to enumerate accounts.
export async function POST(req: NextRequest) {
  return withRoute("auth.forgot-password", "POST", req, async (logger) => {
    if (!checkPolicy("auth.password_reset", getClientIp(req)).allowed) {
      return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    const email = parsed.data.email.toLowerCase();

    const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), eq(users.active, true), isNull(users.deletedAt))).limit(1);
    if (user) {
      const result = await requestCode({ email, purpose: "password_reset" });
      if (result.ok) {
        const sent = await sendPasswordResetEmail(email, result.code);
        if (!sent) logger.warn("reset_email_not_sent", { email, devCode: result.code });
      }
    }
    // Generic response regardless of whether the account exists.
    return NextResponse.json({ ok: true, message: "If an account exists for that email, a reset code is on its way." });
  });
}
