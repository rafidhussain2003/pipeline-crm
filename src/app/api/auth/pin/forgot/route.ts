import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestCode } from "@/lib/auth/verification";
import { sendPinResetEmail } from "@/lib/email/send";
import { checkPolicy, getClientIp } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security/events";

// Email a PIN-reset code to the (already authenticated) user's own address.
// No enumeration concern — the caller is signed in and resetting their own PIN.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!checkPolicy("auth.password_reset", session.userId).allowed) {
    return NextResponse.json({ error: "Please wait before requesting another code." }, { status: 429 });
  }

  const result = await requestCode({ email: session.email, purpose: "pin_reset" });
  if (result.ok) {
    await sendPinResetEmail(session.email, result.code);
    await recordSecurityEvent({ event: "otp.sent", riskLevel: "low", ip: getClientIp(req), email: session.email, companyId: session.companyId, userId: session.userId, reason: "pin reset" });
  }
  // Generic — a live code within the cooldown returns the same message.
  return NextResponse.json({ ok: true, message: "A reset code is on its way to your email." });
}
