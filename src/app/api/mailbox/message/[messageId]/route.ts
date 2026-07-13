import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailMessages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth";

// Per-message actions: star/unstar, read/unread, move folder
// (archive/trash/inbox), and permanent delete (only from Trash). Gmail's
// single-message toolbar.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { messageId } = await params;
  const body = await req.json().catch(() => ({}));

  const patch: Partial<{ isStarred: boolean; isRead: boolean; folder: "inbox" | "sent" | "drafts" | "trash" | "archive" }> = {};
  if (typeof body.isStarred === "boolean") patch.isStarred = body.isStarred;
  if (typeof body.isRead === "boolean") patch.isRead = body.isRead;
  if (typeof body.folder === "string" && ["inbox", "sent", "drafts", "trash", "archive"].includes(body.folder)) {
    patch.folder = body.folder;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "No valid fields" }, { status: 400 });

  const updated = await db.update(emailMessages).set(patch).where(eq(emailMessages.id, messageId)).returning({ id: emailMessages.id });
  if (updated.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Permanent delete — only allowed once a message is already in Trash, so a
// single click can't irreversibly destroy an inbox message.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { messageId } = await params;

  const [msg] = await db.select({ folder: emailMessages.folder }).from(emailMessages).where(eq(emailMessages.id, messageId)).limit(1);
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (msg.folder !== "trash") {
    return NextResponse.json({ error: "Move to Trash before deleting permanently." }, { status: 400 });
  }
  await db.delete(emailMessages).where(eq(emailMessages.id, messageId));
  return NextResponse.json({ ok: true });
}
