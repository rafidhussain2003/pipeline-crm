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
  // long conversation appears once. Paginated at the THREAD level so a page is
  // a bounded, correct window (a thread never splits across pages) — the
  // previous version fetched every message in the folder. `DISTINCT ON (thread)`
  // picks each thread's latest message; the outer query orders by thread
  // recency and applies limit/offset for lazy "load more".
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1), 100);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);

  const res = await db.execute(sql`
    SELECT sub.*, (SELECT count(*)::int FROM email_messages m2 WHERE m2.thread_id = sub.thread_id) AS msg_count
    FROM (
      SELECT DISTINCT ON (m.thread_id)
        m.id, m.thread_id, m.folder, m.from_address, m.to_addresses, m.subject, m.snippet,
        m.is_read, m.is_starred, m.is_draft, m.direction, m.created_at,
        t.last_message_at AS thread_last_at
      FROM email_messages m
      JOIN email_threads t ON t.id = m.thread_id
      WHERE m.mailbox_id = ${mailboxId} AND m.folder = ${folder}
      ORDER BY m.thread_id, m.created_at DESC
    ) sub
    ORDER BY sub.thread_last_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const raw = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  const messages = raw.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    folder: r.folder,
    fromAddress: r.from_address,
    toAddresses: r.to_addresses,
    subject: r.subject,
    snippet: r.snippet,
    isRead: r.is_read,
    isStarred: r.is_starred,
    isDraft: r.is_draft,
    direction: r.direction,
    createdAt: r.created_at,
    threadLastAt: r.thread_last_at,
    msgCount: Number(r.msg_count),
  }));

  return NextResponse.json({ messages, mode: "folder", page: { limit, offset, hasMore: messages.length === limit } });
}
