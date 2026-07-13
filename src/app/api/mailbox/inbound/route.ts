import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { mailboxes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolveThread, storeMessage, htmlToText } from "@/lib/mailbox/store";
import { createLogger } from "@/lib/logger";

const logger = createLogger({ component: "mailbox-inbound" });

// Receives inbound email from Resend's inbound-email webhook and files it
// into the matching mailbox + conversation. Secured by a shared secret
// (MAILBOX_INBOUND_SECRET) passed as ?secret= (configured on the Resend
// webhook URL) — server-to-server, no session. Threading uses the incoming
// References/In-Reply-To so a reply to something we sent lands back in that
// same thread (see storeMessage/resolveThread).
//
// Resilient by design: an unparseable or unmatched payload is logged and
// acknowledged with 200 so the provider doesn't enter a retry storm over a
// message we can't place.
function pickAddress(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "address" in v && typeof (v as { address: unknown }).address === "string") {
    return (v as { address: string }).address;
  }
  return "";
}
function toAddressArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(pickAddress).filter(Boolean);
  const one = pickAddress(v);
  return one ? [one] : [];
}
function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const h = headers as Record<string, unknown>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key && typeof h[key] === "string" ? (h[key] as string) : null;
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.MAILBOX_INBOUND_SECRET || secret !== process.env.MAILBOX_INBOUND_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    logger.warn("inbound_invalid_json");
    return NextResponse.json({ received: true });
  }

  // Resend wraps the message in { type, data } for webhook events; accept
  // both that and a flat payload.
  const data = (body.data as Record<string, unknown>) ?? body;

  try {
    const toList = toAddressArray(data.to);
    const from = pickAddress(data.from);
    const subject = typeof data.subject === "string" ? data.subject : null;
    const html = typeof data.html === "string" ? data.html : null;
    const text = typeof data.text === "string" ? data.text : html ? htmlToText(html) : null;
    const headers = data.headers;
    const messageIdHeader = headerValue(headers, "message-id") || (typeof data.message_id === "string" ? data.message_id : null);
    const inReplyTo = headerValue(headers, "in-reply-to");
    const referencesRaw = headerValue(headers, "references");
    const references = referencesRaw ? referencesRaw.split(/\s+/).filter(Boolean) : null;

    // Match the mailbox by any recipient address that we operate.
    const boxes = await db.select().from(mailboxes);
    const box = boxes.find((b) => toList.some((addr) => addr.toLowerCase() === b.address.toLowerCase()));
    if (!box) {
      logger.warn("inbound_no_matching_mailbox", { to: toList });
      return NextResponse.json({ received: true, matched: false });
    }

    const threadId = await resolveThread({ mailboxId: box.id, subject, inReplyTo, references });

    const attachments = Array.isArray(data.attachments)
      ? (data.attachments as Array<Record<string, unknown>>)
          .filter((a) => typeof a.content === "string" && typeof a.filename === "string")
          .map((a) => ({ filename: a.filename as string, contentType: (a.content_type as string) ?? (a.contentType as string) ?? null, contentBase64: a.content as string }))
      : [];

    await storeMessage({
      threadId,
      mailboxId: box.id,
      direction: "inbound",
      folder: "inbox",
      fromAddress: from || "unknown@unknown",
      toAddresses: toList,
      ccAddresses: toAddressArray(data.cc),
      subject,
      htmlBody: html,
      textBody: text,
      messageIdHeader,
      inReplyTo,
      referencesHeader: references,
      isRead: false,
      attachments,
    });

    return NextResponse.json({ received: true, matched: true });
  } catch (err) {
    logger.error("inbound_processing_failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ received: true });
  }
}
