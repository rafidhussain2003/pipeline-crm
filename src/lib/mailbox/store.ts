// Mailbox persistence + threading. The one place that knows how a message
// becomes a stored row and how a reply is stitched into the right
// conversation. Used by both the outbound (compose/reply/forward) routes
// and the inbound Resend webhook, so a sent message and a received reply end
// up in the same thread, exactly like Gmail.
import { db } from "@/db";
import { emailThreads, emailMessages, emailAttachments } from "@/db/schema";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeSnippet(text: string): string {
  return text.slice(0, 200);
}

// Strips Re:/Fwd: (and localized-ish variants) for subject-based thread
// matching, so "Re: Invoice" threads with "Invoice".
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject || "")
    .replace(/^((re|fw|fwd)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

// This message's own RFC 2822 Message-ID — sent as a header on outbound so
// the recipient's reply carries it in References/In-Reply-To, which is how
// we thread their reply back on the way in.
export function generateMessageId(mailboxAddress: string): string {
  const domain = mailboxAddress.split("@")[1] || "ziplod.com";
  return `<${randomUUID()}@${domain}>`;
}

// Finds the conversation a message belongs to, or creates a new one.
// Priority: explicit threading headers (In-Reply-To / References matched
// against a message we already have) beat the subject fallback, which is
// only used when there are no usable headers (a brand-new inbound cold
// email, or our own first outbound).
export async function resolveThread(params: {
  mailboxId: string;
  subject: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
}): Promise<string> {
  const headerIds = [params.inReplyTo, ...(params.references || [])].filter((x): x is string => !!x);
  if (headerIds.length > 0) {
    const [match] = await db
      .select({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .where(and(eq(emailMessages.mailboxId, params.mailboxId), inArray(emailMessages.messageIdHeader, headerIds)))
      .limit(1);
    if (match) return match.threadId;
  }

  const norm = normalizeSubject(params.subject);
  if (norm) {
    // Match the most recent thread in this mailbox with the same normalized
    // subject — scoped and recent-first so an old unrelated "Invoice" doesn't
    // capture a new one forever; a fresh header-linked reply always wins above.
    const [bySubject] = await db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(and(eq(emailThreads.mailboxId, params.mailboxId), sql`lower(regexp_replace(coalesce(${emailThreads.subject}, ''), '^((re|fw|fwd)\\s*:\\s*)+', '', 'i')) = ${norm}`))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(1);
    if (bySubject) return bySubject.id;
  }

  const [created] = await db
    .insert(emailThreads)
    .values({ mailboxId: params.mailboxId, subject: params.subject, lastMessageAt: new Date() })
    .returning({ id: emailThreads.id });
  return created.id;
}

export type StoredAttachmentInput = { filename: string; contentType?: string | null; contentBase64: string };

// Inserts one message + its attachments and bumps the thread's
// lastMessageAt. Direction/folder/read/sent differ between outbound and
// inbound; everything else is shared.
export async function storeMessage(params: {
  threadId: string;
  mailboxId: string;
  direction: "inbound" | "outbound";
  folder: "inbox" | "sent" | "drafts" | "trash" | "archive";
  fromAddress: string;
  toAddresses: string[];
  ccAddresses?: string[] | null;
  bccAddresses?: string[] | null;
  subject: string | null;
  htmlBody: string | null;
  textBody: string | null;
  messageIdHeader?: string | null;
  inReplyTo?: string | null;
  referencesHeader?: string[] | null;
  providerId?: string | null;
  isRead?: boolean;
  isDraft?: boolean;
  sentAt?: Date | null;
  attachments?: StoredAttachmentInput[];
}): Promise<string> {
  const text = params.textBody || (params.htmlBody ? htmlToText(params.htmlBody) : "");
  const [msg] = await db
    .insert(emailMessages)
    .values({
      threadId: params.threadId,
      mailboxId: params.mailboxId,
      direction: params.direction,
      folder: params.folder,
      fromAddress: params.fromAddress,
      toAddresses: params.toAddresses,
      ccAddresses: params.ccAddresses ?? null,
      bccAddresses: params.bccAddresses ?? null,
      subject: params.subject,
      htmlBody: params.htmlBody,
      textBody: params.textBody,
      snippet: makeSnippet(text),
      messageIdHeader: params.messageIdHeader ?? null,
      inReplyTo: params.inReplyTo ?? null,
      referencesHeader: params.referencesHeader ?? null,
      providerId: params.providerId ?? null,
      isRead: params.isRead ?? params.direction === "outbound",
      isDraft: params.isDraft ?? false,
      sentAt: params.sentAt ?? (params.direction === "outbound" && !params.isDraft ? new Date() : null),
    })
    .returning({ id: emailMessages.id });

  if (params.attachments && params.attachments.length > 0) {
    await db.insert(emailAttachments).values(
      params.attachments.map((a) => ({
        messageId: msg.id,
        filename: a.filename,
        contentType: a.contentType ?? null,
        size: Buffer.from(a.contentBase64, "base64").length, // exact decoded byte count
        contentBase64: a.contentBase64,
      }))
    );
  }

  // Drafts don't advance the conversation timestamp (they're not really part
  // of the visible chain until sent).
  if (!params.isDraft) {
    await db.update(emailThreads).set({ lastMessageAt: new Date() }).where(eq(emailThreads.id, params.threadId));
  }
  return msg.id;
}
