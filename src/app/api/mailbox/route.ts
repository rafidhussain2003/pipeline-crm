import { NextResponse } from "next/server";
import { db } from "@/db";
import { mailboxes, emailMessages, emailLabels } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth";
import { isMailboxSendConfigured } from "@/lib/mailbox/resend";

// Bootstrap payload for the mailbox UI: the operated addresses, the labels,
// per-mailbox unread counts, and whether sending is configured yet (so the
// UI can show a "add your Resend key" hint instead of silently failing).
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const boxes = await db.select().from(mailboxes).orderBy(mailboxes.address);

  const unreadRows = await db
    .select({ mailboxId: emailMessages.mailboxId, unread: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(and(eq(emailMessages.folder, "inbox"), eq(emailMessages.isRead, false)))
    .groupBy(emailMessages.mailboxId);
  const unreadByMailbox = new Map(unreadRows.map((r) => [r.mailboxId, r.unread]));

  const labels = await db.select().from(emailLabels).orderBy(emailLabels.name);

  return NextResponse.json({
    mailboxes: boxes.map((b) => ({ ...b, unread: unreadByMailbox.get(b.id) ?? 0 })),
    labels,
    sendConfigured: isMailboxSendConfigured(),
  });
}
