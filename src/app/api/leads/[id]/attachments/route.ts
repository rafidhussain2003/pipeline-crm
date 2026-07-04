import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadAttachments, leads } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

// Design note: attachments are stored as metadata + a URL, not as binary
// uploads through this server. Render's web service filesystem is
// ephemeral (wiped on every deploy/restart), so saving files directly to
// disk would silently lose them. Instead, the person pastes a link to a
// file already hosted somewhere durable (Google Drive, Dropbox, S3, etc).
// If you want true in-app file uploads later, the clean way is to add an
// S3-compatible bucket (S3 / Cloudflare R2 / Backblaze B2) and swap this
// for a signed-upload-URL flow — the schema (lead_attachments) doesn't
// need to change, only how fileUrl gets populated.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(leadAttachments)
    .where(eq(leadAttachments.leadId, id))
    .orderBy(desc(leadAttachments.createdAt));

  return NextResponse.json({ attachments: rows });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { fileName, fileUrl, fileSize } = await req.json();
  if (!fileName || !fileUrl) return NextResponse.json({ error: "fileName and fileUrl are required" }, { status: 400 });

  const [lead] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, id), eq(leads.companyId, session.companyId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [attachment] = await db
    .insert(leadAttachments)
    .values({ leadId: id, fileName, fileUrl, fileSize: fileSize || null, uploadedBy: session.userId })
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "lead.attachment_added",
    entityType: "lead",
    entityId: id,
    metadata: { fileName },
  });

  return NextResponse.json({ attachment });
}
