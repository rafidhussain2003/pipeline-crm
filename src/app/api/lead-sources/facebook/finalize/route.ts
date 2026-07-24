import { NextRequest, NextResponse } from "next/server";
import { getSession, verifyShortLived } from "@/lib/auth";
import { PENDING_PAGES_COOKIE } from "@/lib/facebook-oauth";
import type { ProviderContainer } from "@/lib/lead-sources/provider";
import { getProvider } from "@/lib/lead-sources/registry";
import { db } from "@/db";
import { leadSources, leadForms } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { and, eq, isNull } from "drizzle-orm";

type PendingSelection = {
  companyId: string;
  accountId: string;
  pages: ProviderContainer[];
  tokenExpiresIn: number | null;
  reconnectSourceId: string | null;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can connect pages" }, { status: 403 });
  }

  const { pageId, forms } = await req.json();
  if (!pageId) return NextResponse.json({ error: "pageId is required" }, { status: 400 });
  const selectedForms: { id: string; name: string }[] = Array.isArray(forms) ? forms : [];

  const token = req.cookies.get(PENDING_PAGES_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Your Facebook connection expired. Please connect again." }, { status: 400 });

  const payload = verifyShortLived<PendingSelection>(token);
  if (!payload || payload.companyId !== session.companyId) {
    return NextResponse.json({ error: "Your Facebook connection expired. Please connect again." }, { status: 400 });
  }

  const page = payload.pages.find((p) => p.id === pageId);
  if (!page) return NextResponse.json({ error: "Page not found in this session" }, { status: 404 });

  const provider = getProvider("facebook")!;

  try {
    await provider.subscribeWebhook(page.id, page.accessToken);
  } catch (err) {
    console.error("Failed to subscribe page webhook:", err);
    return NextResponse.json({ error: "Facebook rejected the webhook subscription for this page." }, { status: 400 });
  }

  const tokenExpiresAt = payload.tokenExpiresIn ? new Date(Date.now() + payload.tokenExpiresIn * 1000) : null;

  // Reconnect resumes into this same flow (see /api/oauth/facebook/start's
  // ?reconnect=<id> param) and carries the existing source's id through
  // `state` -> the pending-selection cookie, so re-authorizing updates that
  // row in place (keeping its id, createdAt, and any leads already
  // attributed to it) instead of creating a duplicate connection.
  let existingSource: { id: string } | null = null;
  if (payload.reconnectSourceId) {
    const [row] = await db
      .select({ id: leadSources.id })
      .from(leadSources)
      .where(
        and(
          eq(leadSources.id, payload.reconnectSourceId),
          eq(leadSources.companyId, session.companyId),
          isNull(leadSources.deletedAt)
        )
      )
      .limit(1);
    existingSource = row || null;
  }

  const sourceValues = {
    accountId: payload.accountId,
    pageId: page.id,
    pageName: page.name,
    businessId: page.business?.id || null,
    businessName: page.business?.name || null,
    accessToken: encrypt(page.accessToken),
    status: "connected" as const,
    webhookStatus: "active" as const,
    lastError: null,
    tokenExpiresAt,
  };

  const source = existingSource
    ? (await db.update(leadSources).set(sourceValues).where(eq(leadSources.id, existingSource.id)).returning())[0]
    : (
        await db
          .insert(leadSources)
          .values({ ...sourceValues, companyId: session.companyId, platform: "facebook", createdBy: session.userId })
          .returning()
      )[0];

  // Replace the form selection wholesale rather than merging — the
  // reconnect UI shows the customer's current selection pre-ticked, so
  // whatever they submit here is the intended full set going forward.
  if (existingSource) {
    await db.delete(leadForms).where(eq(leadForms.sourceId, source.id));
  }
  if (selectedForms.length > 0) {
    await db.insert(leadForms).values(
      // Display name (agent-facing) initializes to the actual form name on
      // connect, until an admin customizes it — form SETUP, not lead
      // ingestion. Agents/managers see this value; the real name is admin-only.
      selectedForms.map((f) => ({ sourceId: source.id, formId: f.id, formName: f.name || null, agentDisplayName: f.name || null, enabled: true }))
    );
  }

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: existingSource ? "lead_source.reconnected" : "lead_source.connected",
    entityType: "lead_source",
    entityId: source.id,
    after: {
      platform: "facebook",
      pageId: page.id,
      pageName: page.name,
      businessName: page.business?.name || null,
      formCount: selectedForms.length,
    },
  });

  return NextResponse.json({
    source: { id: source.id, pageId: page.id, pageName: page.name, businessName: page.business?.name || null },
  });
}
