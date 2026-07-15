// Phase 13 — transactional email (verification codes, agent invitations,
// password resets). Reuses the existing Resend adapter (src/lib/mailbox/resend)
// so there is one place that knows "is email configured." When RESEND_API_KEY
// is absent the send is a logged no-op that returns ok:false with a clear
// reason — the flows still work in dev (the API routes log the code so it can
// be read from the server logs), they just don't put mail on the wire.
import { sendViaResend } from "@/lib/mailbox/resend";
import { getPublicAppUrl } from "@/lib/url";

const FROM = process.env.EMAIL_FROM || "Ziplod <noreply@ziplod.com>";

function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
      <div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:16px">Ziplod</div>
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 12px">${title}</h1>
      ${body}
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px">Ziplod — fast lead management</p>
  </div></body></html>`;
}

function codeBlock(code: string): string {
  return `<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f172a;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center;margin:16px 0">${code}</div>`;
}

export async function sendVerificationEmail(email: string, code: string): Promise<boolean> {
  const html = shell(
    "Verify your email",
    `<p style="font-size:14px;color:#475569">Enter this code to finish creating your Ziplod account. It expires in 10 minutes.</p>${codeBlock(code)}<p style="font-size:12px;color:#94a3b8">If you didn't request this, you can safely ignore this email.</p>`
  );
  const res = await sendViaResend({ from: FROM, to: [email], subject: `${code} is your Ziplod verification code`, html, text: `Your Ziplod verification code is ${code}. It expires in 10 minutes.` });
  return res.ok;
}

export async function sendPasswordResetEmail(email: string, code: string): Promise<boolean> {
  const html = shell(
    "Reset your password",
    `<p style="font-size:14px;color:#475569">Use this code to reset your Ziplod password. It expires in 10 minutes.</p>${codeBlock(code)}<p style="font-size:12px;color:#94a3b8">If you didn't request a reset, ignore this email — your password won't change.</p>`
  );
  const res = await sendViaResend({ from: FROM, to: [email], subject: `${code} is your Ziplod password reset code`, html, text: `Your Ziplod password reset code is ${code}. It expires in 10 minutes.` });
  return res.ok;
}

export async function sendInvitationEmail(params: { email: string; name: string; companyName: string; tempPassword: string }): Promise<boolean> {
  const loginUrl = `${getPublicAppUrl()}/login`;
  const html = shell(
    `You're invited to ${params.companyName} on Ziplod`,
    `<p style="font-size:14px;color:#475569">Hi ${params.name}, an admin added you to <strong>${params.companyName}</strong>. Sign in with the temporary password below — you'll be asked to create your own password on first login.</p>
     <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:16px 0">
       <div style="font-size:12px;color:#94a3b8">Email</div><div style="font-size:14px;color:#0f172a;margin-bottom:8px">${params.email}</div>
       <div style="font-size:12px;color:#94a3b8">Temporary password</div><div style="font-size:16px;font-weight:600;color:#0f172a;font-family:monospace">${params.tempPassword}</div>
     </div>
     <a href="${loginUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:6px">Sign in</a>`
  );
  const res = await sendViaResend({ from: FROM, to: [params.email], subject: `You've been invited to ${params.companyName} on Ziplod`, html, text: `You were invited to ${params.companyName} on Ziplod. Sign in at ${loginUrl} with temporary password: ${params.tempPassword} (you'll set your own on first login).` });
  return res.ok;
}
