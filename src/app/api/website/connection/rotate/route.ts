import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getWebsiteSources, rotateSecretKey } from "@/lib/website";

// Rotate the Website connection's secret key (admin-only). The public key
// (source id) never changes, so embedded SDK snippets keep working; only
// server-to-server callers using the old secret must update.
export async function POST() {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sources = await getWebsiteSources(session.companyId);
  if (sources.length === 0) return NextResponse.json({ error: "No website connection to rotate." }, { status: 404 });

  const secret = await rotateSecretKey(sources[0].id, session.companyId);
  if (!secret) return NextResponse.json({ error: "No website connection to rotate." }, { status: 404 });

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "website_connection.secret_rotated",
    entityType: "lead_source",
    entityId: sources[0].id,
  });

  return NextResponse.json({ secretKey: secret });
}
