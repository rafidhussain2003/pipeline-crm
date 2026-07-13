import { NextResponse } from "next/server";
import { db } from "@/db";
import { emailThreads, emailMessages, emailAttachments, emailMessageLabels } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth";

// The conversation view: every message in a thread oldest-first, with each
// message's attachments (metadata only — bytes are downloaded on demand) and
// applied labels. Opening a thread marks its unread inbound messages read.
export async function GET(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { threadId } = await params;

  const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.id, threadId)).limit(1);
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.threadId, threadId))
    .orderBy(asc(emailMessages.createdAt));

  const messageIds = messages.map((m) => m.id);
  const attachments = messageIds.length
    ? await db
        .select({ id: emailAttachments.id, messageId: emailAttachments.messageId, filename: emailAttachments.filename, contentType: emailAttachments.contentType, size: emailAttachments.size })
        .from(emailAttachments)
        .where(inArray(emailAttachments.messageId, messageIds))
    : [];
  const labelLinks = messageIds.length
    ? await db.select().from(emailMessageLabels).where(inArray(emailMessageLabels.messageId, messageIds))
    : [];

  // Mark unread inbound messages in this thread as read on open.
  const unreadIds = messages.filter((m) => !m.isRead && m.direction === "inbound").map((m) => m.id);
  if (unreadIds.length > 0) {
    await db.update(emailMessages).set({ isRead: true }).where(inArray(emailMessages.id, unreadIds));
  }

  const attByMsg = new Map<string, typeof attachments>();
  for (const a of attachments) {
    const list = attByMsg.get(a.messageId) || [];
    list.push(a);
    attByMsg.set(a.messageId, list);
  }
  const labelsByMsg = new Map<string, string[]>();
  for (const l of labelLinks) {
    const list = labelsByMsg.get(l.messageId) || [];
    list.push(l.labelId);
    labelsByMsg.set(l.messageId, list);
  }

  return NextResponse.json({
    thread,
    messages: messages.map((m) => ({
      ...m,
      isRead: unreadIds.includes(m.id) ? true : m.isRead,
      attachments: attByMsg.get(m.id) || [],
      labelIds: labelsByMsg.get(m.id) || [],
    })),
  });
}

// Thread-level actions: move every message in the thread to a folder
// (archive/trash/inbox restore), used by the conversation-view toolbar.
export async function PATCH(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { threadId } = await params;
  const body = await req.json().catch(() => ({}));
  const folder = body.folder as "inbox" | "archive" | "trash" | undefined;
  if (!folder || !["inbox", "archive", "trash"].includes(folder)) {
    return NextResponse.json({ error: "folder must be inbox, archive, or trash" }, { status: 400 });
  }
  // Sent messages stay in Sent even when the thread is archived/trashed — a
  // record of what you sent shouldn't vanish from Sent. Only inbound/inbox/
  // archive messages move.
  await db
    .update(emailMessages)
    .set({ folder })
    .where(and(eq(emailMessages.threadId, threadId), inArray(emailMessages.folder, ["inbox", "archive", "trash"])));
  return NextResponse.json({ ok: true });
}
