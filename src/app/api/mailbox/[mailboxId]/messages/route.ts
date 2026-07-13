import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailMessages, emailThreads, mailboxes } from "@/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth";

// The message-list pane: the latest message per thread for one folder of one
// mailbox (so a conversation shows once, Gmail-style), or a flat search
// across the mailbox when ?q= is present. Bounded and index-backed.
export async function GET(req: NextRequest, { params }: { params: Promise<{ mailboxId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { mailboxId } = await params;

  const [box] = await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
  if (!box) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });

  const folder = (req.nextUrl.searchParams.get("folder") || "inbox") as
    | "inbox"
    | "sent"
    | "drafts"
    | "trash"
    | "archive"
    | "starred";
  const q = req.nextUrl.searchParams.get("q")?.trim();

  // Search spans subject + snippet + participants across the whole mailbox
  // (all folders except trash), newest first.
  if (q) {
    const like = `%${q}%`;
    const rows = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
        folder: emailMessages.folder,
        fromAddress: emailMessages.fromAddress,
        toAddresses: emailMessages.toAddresses,
        subject: emailMessages.subject,
        snippet: emailMessages.snippet,
        isRead: emailMessages.isRead,
        isStarred: emailMessages.isStarred,
        direction: emailMessages.direction,
        createdAt: emailMessages.createdAt,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.mailboxId, mailboxId),
          sql`${emailMessages.folder} <> 'trash'`,
          or(
            ilike(emailMessages.subject, like),
            ilike(emailMessages.snippet, like),
            ilike(emailMessages.fromAddress, like),
            sql`${emailMessages.toAddresses}::text ILIKE ${like}`
          )
        )
      )
      .orderBy(desc(emailMessages.createdAt))
      .limit(200);
    return NextResponse.json({ messages: rows, mode: "search" });
  }

  // "starred" is a cross-folder view (any non-trash starred message).
  if (folder === "starred") {
    const rows = await db
      .select()
      .from(emailMessages)
      .where(and(eq(emailMessages.mailboxId, mailboxId), eq(emailMessages.isStarred, true), sql`${emailMessages.folder} <> 'trash'`))
      .orderBy(desc(emailMessages.createdAt))
      .limit(200);
    return NextResponse.json({ messages: rows, mode: "starred" });
  }

  // Folder view: one row per thread (its latest message in this folder), so a
  // long conversation appears once. DISTINCT ON (thread) ordered by recency.
  const rows = await db
    .select({
      id: emailMessages.id,
      threadId: emailMessages.threadId,
      folder: emailMessages.folder,
      fromAddress: emailMessages.fromAddress,
      toAddresses: emailMessages.toAddresses,
      subject: emailMessages.subject,
      snippet: emailMessages.snippet,
      isRead: emailMessages.isRead,
      isStarred: emailMessages.isStarred,
      isDraft: emailMessages.isDraft,
      direction: emailMessages.direction,
      createdAt: emailMessages.createdAt,
      threadLastAt: emailThreads.lastMessageAt,
      msgCount: sql<number>`(select count(*)::int from ${emailMessages} m2 where m2.thread_id = ${emailMessages.threadId})`,
    })
    .from(emailMessages)
    .innerJoin(emailThreads, eq(emailMessages.threadId, emailThreads.id))
    .where(and(eq(emailMessages.mailboxId, mailboxId), eq(emailMessages.folder, folder)))
    .orderBy(emailMessages.threadId, desc(emailMessages.createdAt));

  // De-dupe to the latest message per thread in JS (portable, avoids a
  // DISTINCT ON + ordering mismatch), then sort by thread recency.
  const latestPerThread = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latestPerThread.has(r.threadId)) latestPerThread.set(r.threadId, r);
  const list = [...latestPerThread.values()].sort(
    (a, b) => new Date(b.threadLastAt).getTime() - new Date(a.threadLastAt).getTime()
  );

  return NextResponse.json({ messages: list, mode: "folder" });
}
