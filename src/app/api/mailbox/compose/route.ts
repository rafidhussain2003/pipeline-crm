import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mailboxes, emailMessages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth";
import { checkPolicy } from "@/lib/rate-limit";
import { sendMessage } from "@/lib/mailbox/send";
import { resolveThread, storeMessage, htmlToText } from "@/lib/mailbox/store";
import type { StoredAttachmentInput } from "@/lib/mailbox/store";

// ~8MB per attachment (base64 is ~4/3 of raw). Bounded because attachment
// bytes are stored inline in Postgres for this internal mailbox.
const MAX_ATTACHMENT_B64 = 11_000_000;

function asAddressList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.includes("@"));
  if (typeof v === "string") return v.split(/[,;]/).map((s) => s.trim()).filter((s) => s.includes("@"));
  return [];
}

// Compose / reply / reply-all / forward all land here — the client builds the
// recipients/subject/quoted body; this validates, optionally saves as a
// draft, or sends via Resend and files it in Sent + the right thread.
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const rl = checkPolicy("api.admin", auth.session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const { mailboxId, subject, html, inReplyToMessageId, saveDraft } = body;
  const to = asAddressList(body.to);
  const cc = asAddressList(body.cc);
  const bcc = asAddressList(body.bcc);

  const [box] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
  if (!box) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });

  const attachments: StoredAttachmentInput[] = Array.isArray(body.attachments)
    ? body.attachments
        .filter((a: unknown): a is { filename: string; contentType?: string; contentBase64: string } =>
          !!a && typeof (a as { filename?: unknown }).filename === "string" && typeof (a as { contentBase64?: unknown }).contentBase64 === "string"
        )
        .map((a: { filename: string; contentType?: string; contentBase64: string }) => ({ filename: a.filename, contentType: a.contentType ?? null, contentBase64: a.contentBase64 }))
    : [];
  if (attachments.some((a) => a.contentBase64.length > MAX_ATTACHMENT_B64)) {
    return NextResponse.json({ error: "Attachment too large (max ~8MB each)." }, { status: 413 });
  }

  // Save as draft: persist to Drafts, don't send. No recipients required yet.
  if (saveDraft) {
    const threadId = await resolveThread({ mailboxId, subject: subject || "(no subject)", inReplyTo: null, references: null });
    const messageId = await storeMessage({
      threadId,
      mailboxId,
      direction: "outbound",
      folder: "drafts",
      fromAddress: box.address,
      toAddresses: to,
      ccAddresses: cc.length ? cc : null,
      bccAddresses: bcc.length ? bcc : null,
      subject: subject || null,
      htmlBody: html || "",
      textBody: htmlToText(html || ""),
      isRead: true,
      isDraft: true,
      attachments,
    });
    return NextResponse.json({ ok: true, draft: true, messageId });
  }

  if (to.length === 0) return NextResponse.json({ error: "At least one valid recipient is required." }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Subject is required." }, { status: 400 });

  const result = await sendMessage({
    mailboxId,
    fromAddress: box.address,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject,
    html: html || "",
    inReplyToMessageId: inReplyToMessageId || null,
    attachments,
  });

  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 502 });

  // If this send originated from editing a draft, remove the draft row now
  // that a real Sent copy exists.
  if (body.fromDraftId) {
    await db.delete(emailMessages).where(eq(emailMessages.id, body.fromDraftId));
  }

  return NextResponse.json({ ok: true, messageId: result.messageId, providerId: result.providerId });
}
