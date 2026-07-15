import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailAttachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/auth";

// Serves an attachment's bytes (decoded from the stored base64) with the
// right content-type and a download disposition. Super-admin only, like
// everything else in the mailbox.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { attachmentId } = await params;

  const [att] = await db.select().from(emailAttachments).where(eq(emailAttachments.id, attachmentId)).limit(1);
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = Buffer.from(att.contentBase64, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": att.contentType || "application/octet-stream",
      // Force a download (never inline-render) AND stop the browser from
      // MIME-sniffing a mislabeled attachment into executable HTML — together
      // these neutralize XSS via a malicious HTML/SVG attachment.
      "Content-Disposition": `attachment; filename="${att.filename.replace(/[\r\n"]/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(bytes.length),
    },
  });
}
