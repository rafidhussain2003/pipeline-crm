// Resend send adapter for the Platform Owner Mailbox. Isolated here so the
// rest of the mailbox never imports the SDK directly and the "no key
// configured yet" path is handled in exactly one place: when RESEND_API_KEY
// is absent the send is a logged no-op that reports success:false with a
// clear reason, so the whole mailbox (compose, drafts, threading, folders,
// search) is fully usable and testable before the key + domain are set up —
// it just can't put real mail on the wire yet.
import { Resend } from "resend";

export type OutboundAttachment = { filename: string; content: string; contentType?: string }; // content = base64

export type SendResult = { ok: true; providerId: string | null } | { ok: false; reason: string };

let client: Resend | null = null;
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export function isMailboxSendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendViaResend(params: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: OutboundAttachment[];
  // RFC threading headers so replies land in the recipient's same
  // conversation (and theirs land back in ours — see the inbound webhook).
  headers?: Record<string, string>;
}): Promise<SendResult> {
  const resend = getClient();
  if (!resend) {
    console.log(`[mailbox:not-sent] from=${params.from} to=${params.to.join(",")} subject="${params.subject}" (RESEND_API_KEY not set)`);
    return { ok: false, reason: "Email sending isn't configured yet — add RESEND_API_KEY and verify the domain in Resend." };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: params.from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      headers: params.headers,
    });
    if (error) return { ok: false, reason: error.message || "Resend rejected the message" };
    return { ok: true, providerId: data?.id ?? null };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown send error" };
  }
}
