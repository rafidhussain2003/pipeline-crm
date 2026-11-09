// E-Sign emails: the signing request (with the private link), the completed
// notice (signed PDF attached), and the decline notice to the sender.
import { sendViaResend } from "@/lib/mailbox/resend";

const FROM = process.env.EMAIL_FROM || "Ziplod <noreply@ziplod.com>";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function shell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 12px">${title}</h1>
      ${body}
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px">Sent via Ziplod Docusign. The link is private to you — please don't forward it.</p>
  </div></body></html>`;
}
const button = (href: string, label: string) => `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:8px">${label}</a></p><p style="font-size:12px;color:#94a3b8;word-break:break-all">Or open this link: ${href}</p>`;

export async function sendSigningRequestEmail(p: { to: string; signerName: string; sender: string; title: string; message?: string | null; link: string; reminder?: boolean }): Promise<{ ok: boolean; reason?: string }> {
  const html = shell(
    p.reminder ? `Reminder: ${esc(p.title)} is waiting for your signature` : `${esc(p.sender)} sent you a document to sign`,
    `<p style="font-size:14px;color:#475569">Hi ${esc(p.signerName)},</p><p style="font-size:14px;color:#475569"><strong>${esc(p.sender)}</strong> has asked you to review and sign <strong>${esc(p.title)}</strong>. No account is needed — open the link, review the document and sign where indicated.</p>${p.message ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-left:3px solid #cbd5e1;color:#475569;font-size:14px">${esc(p.message)}</blockquote>` : ""}${button(p.link, "Review & sign")}`
  );
  const res = await sendViaResend({ from: FROM, to: [p.to], subject: `${p.reminder ? "Reminder: " : ""}Please sign: ${p.title}`, html, text: `${p.sender} asked you to sign "${p.title}". Open: ${p.link}${p.message ? `\n\n${p.message}` : ""}` });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

export async function sendCompletedEmail(p: { to: string; name: string; title: string; link: string; pdf: Buffer; fileName: string }): Promise<{ ok: boolean; reason?: string }> {
  const html = shell(
    `Completed: ${esc(p.title)}`,
    `<p style="font-size:14px;color:#475569">Hi ${esc(p.name)}, everyone has signed <strong>${esc(p.title)}</strong>. The signed copy is attached and can also be downloaded from the link below.</p>${button(p.link, "View signed document")}`
  );
  const res = await sendViaResend({ from: FROM, to: [p.to], subject: `Completed: ${p.title}`, html, text: `Everyone has signed "${p.title}". Download: ${p.link}`, attachments: [{ filename: p.fileName, content: p.pdf.toString("base64"), contentType: "application/pdf" }] });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

export async function sendDeclinedEmail(p: { to: string; adminName: string; signerName: string; signerEmail: string; title: string; reason: string | null; link: string }): Promise<{ ok: boolean; reason?: string }> {
  const html = shell(
    `${esc(p.signerName)} declined to sign ${esc(p.title)}`,
    `<p style="font-size:14px;color:#475569">Hi ${esc(p.adminName)}, <strong>${esc(p.signerName)}</strong> (${esc(p.signerEmail)}) declined to sign <strong>${esc(p.title)}</strong>.${p.reason ? ` Reason given: <em>${esc(p.reason)}</em>` : ""}</p>${button(p.link, "Open document")}`
  );
  const res = await sendViaResend({ from: FROM, to: [p.to], subject: `Declined: ${p.title}`, html, text: `${p.signerName} declined "${p.title}". ${p.reason ?? ""} ${p.link}` });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}
