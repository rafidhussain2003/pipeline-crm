import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { and, eq, isNull } from "drizzle-orm";
import crypto from "crypto";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: leadSources.id,
      platform: leadSources.platform,
      pageId: leadSources.pageId,
      pageName: leadSources.pageName,
      status: leadSources.status,
      webhookSecret: leadSources.webhookSecret,
      fieldMapping: leadSources.fieldMapping,
      lastSyncedAt: leadSources.lastSyncedAt,
      createdAt: leadSources.createdAt,
    })
    .from(leadSources)
    .where(and(eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)));

  return NextResponse.json({ sources: rows });
}

// Handles three cases:
// - platform "facebook" (manual/advanced path — OAuth is the primary flow,
//   see /api/oauth/facebook/*): pastes a Page access token, resolved via Graph API.
// - platform "generic": a universal webhook connector for any form
//   builder/CRM/Google Lead Forms relay — generates a secret + accepts a
//   field mapping so arbitrary JSON payloads can be mapped to name/phone/email.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { accessToken, platform, name, fieldMapping } = await req.json();

  if (platform === "generic" || platform === "google") {
    const webhookSecret = crypto.randomBytes(24).toString("hex");
    const [source] = await db
      .insert(leadSources)
      .values({
        companyId: session.companyId,
        platform,
        pageName: name || (platform === "google" ? "Google Lead Form" : "Generic Webhook"),
        webhookSecret,
        fieldMapping: fieldMapping || { name: "name", phone: "phone", email: "email" },
        status: "active",
      })
      .returning();

    // Note: intentionally not logging webhookSecret/fieldMapping contents —
    // the secret is sensitive, and fieldMapping may echo customer-provided
    // field names but never actual lead data.
    await recordAudit({
      companyId: session.companyId,
      userId: session.userId,
      action: "webhook_source.created",
      entityType: "lead_source",
      entityId: source.id,
      after: { platform: source.platform, pageName: source.pageName },
    });

    return NextResponse.json({
      source: {
        id: source.id,
        platform: source.platform,
        pageName: source.pageName,
        webhookSecret,
        webhookUrl: `/api/webhooks/generic/${source.id}`,
      },
    });
  }

  if (!accessToken) return NextResponse.json({ error: "Access token is required" }, { status: 400 });

  let res: Response;
  try {
    res = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
  } catch (err) {
    console.error("Facebook Graph API request failed:", err);
    return NextResponse.json(
      { error: "Could not reach Facebook right now. Please try again." },
      { status: 502 }
    );
  }
  if (!res.ok) {
    return NextResponse.json({ error: "Facebook rejected this token. Double-check it's a Page access token." }, { status: 400 });
  }
  const data = await res.json();
  const pageId: string | undefined = data.id;
  const pageName: string | undefined = data.name;

  const [source] = await db
    .insert(leadSources)
    .values({
      companyId: session.companyId,
      platform: "facebook",
      pageId,
      pageName,
      accessToken: encrypt(accessToken),
      status: "active",
    })
    .returning();

  // Not logging accessToken (encrypted at rest, but still shouldn't appear
  // in the audit trail).
  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "webhook_source.created",
    entityType: "lead_source",
    entityId: source.id,
    after: { platform: source.platform, pageId, pageName },
  });

  return NextResponse.json({
    source: { id: source.id, pageId, pageName, platform: source.platform, status: source.status },
  });
}
