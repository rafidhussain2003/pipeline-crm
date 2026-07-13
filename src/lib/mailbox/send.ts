// Compose / reply / forward orchestration: put the message on the wire via
// Resend, then persist it (folder=sent) into the right thread. Shared by the
// compose, reply, reply-all, and forward routes — they differ only in how
// they build the recipients/subject/quoted body before calling this.
import { db } from "@/db";
import { emailMessages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendViaResend, type OutboundAttachment } from "./resend";
import { resolveThread, storeMessage, generateMessageId, htmlToText, type StoredAttachmentInput } from "./store";

export type ComposeInput = {
  mailboxId: string;
  fromAddress: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  // For a reply/forward: the message being responded to, so we thread it and
  // build the correct In-Reply-To / References chain.
  inReplyToMessageId?: string | null;
  attachments?: StoredAttachmentInput[];
};

export async function sendMessage(
  input: ComposeInput
): Promise<{ ok: true; messageId: string; providerId: string | null } | { ok: false; reason: string }> {
  // Build RFC threading headers from the parent (if this is a reply/forward).
  let inReplyToHeader: string | null = null;
  let referencesHeader: string[] | null = null;
  let threadId: string | null = null;

  if (input.inReplyToMessageId) {
    const [parent] = await db
      .select({
        threadId: emailMessages.threadId,
        messageIdHeader: emailMessages.messageIdHeader,
        referencesHeader: emailMessages.referencesHeader,
      })
      .from(emailMessages)
      .where(eq(emailMessages.id, input.inReplyToMessageId))
      .limit(1);
    if (parent) {
      threadId = parent.threadId;
      inReplyToHeader = parent.messageIdHeader;
      referencesHeader = [...((parent.referencesHeader as string[] | null) || []), parent.messageIdHeader].filter(
        (x): x is string => !!x
      );
    }
  }

  if (!threadId) {
    threadId = await resolveThread({ mailboxId: input.mailboxId, subject: input.subject, inReplyTo: inReplyToHeader, references: referencesHeader });
  }

  const ownMessageId = generateMessageId(input.fromAddress);
  const headers: Record<string, string> = { "Message-ID": ownMessageId };
  if (inReplyToHeader) headers["In-Reply-To"] = inReplyToHeader;
  if (referencesHeader && referencesHeader.length > 0) headers["References"] = referencesHeader.join(" ");

  const outboundAttachments: OutboundAttachment[] | undefined = input.attachments?.map((a) => ({
    filename: a.filename,
    content: a.contentBase64,
    contentType: a.contentType ?? undefined,
  }));

  const sent = await sendViaResend({
    from: input.fromAddress,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html: input.html,
    text: htmlToText(input.html),
    attachments: outboundAttachments,
    headers,
  });

  if (!sent.ok) return { ok: false, reason: sent.reason };

  const messageId = await storeMessage({
    threadId,
    mailboxId: input.mailboxId,
    direction: "outbound",
    folder: "sent",
    fromAddress: input.fromAddress,
    toAddresses: input.to,
    ccAddresses: input.cc ?? null,
    bccAddresses: input.bcc ?? null,
    subject: input.subject,
    htmlBody: input.html,
    textBody: htmlToText(input.html),
    messageIdHeader: ownMessageId,
    inReplyTo: inReplyToHeader,
    referencesHeader,
    providerId: sent.providerId,
    isRead: true,
    sentAt: new Date(),
    attachments: input.attachments,
  });

  return { ok: true, messageId, providerId: sent.providerId };
}
