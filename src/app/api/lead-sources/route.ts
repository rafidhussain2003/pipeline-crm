import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, connectedAccounts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { canSeeActualSourceName } from "@/lib/leads/source-privacy";
import { and, eq, isNull } from "drizzle-orm";
import crypto from "crypto";
import { recordAudit } from "@/lib/audit";
import { getProvider } from "@/lib/lead-sources/registry";

// Returns every connected Page (`sources`) alongside every connected
// account (`accounts`) for this company — the Lead Sources page groups
// sources by their accountId client-side (Meta Account -> Business ->
// Pages, per the multi-account architecture in db/schema.ts) rather than
// this route pre-nesting the response, which keeps the shape simple and
// matches how `sources` was already consumed before accounts existed.
export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Phase 3 — this endpoint returns the REAL campaign names (and the alias
  // beside them) for the settings UI, so it is restricted to the roles
  // entitled to see them. It previously required only a session, which meant
  // an agent could read every actual source name straight from the API even
  // though no screen showed it to them — the privacy layer would have been
  // cosmetic. Same predicate as every other resolution point.
  if (!canSeeActualSourceName(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [rows, accounts] = await Promise.all([
    db
      .select({
        id: leadSources.id,
        accountId: leadSources.accountId,
        platform: leadSources.platform,
        pageId: leadSources.pageId,
        pageName: leadSources.pageName,
        // Phase 3 — this endpoint is admin/manager only, so it returns BOTH the
        // real name and the agent-facing alias; the settings UI needs the pair
        // to show one read-only beside the other without a second query.
        agentDisplayName: leadSources.agentDisplayName,
        businessId: leadSources.businessId,
        businessName: leadSources.businessName,
        status: leadSources.status,
        webhookStatus: leadSources.webhookStatus,
        lastError: leadSources.lastError,
        tokenExpiresAt: leadSources.tokenExpiresAt,
        webhookSecret: leadSources.webhookSecret,
        fieldMapping: leadSources.fieldMapping,
        lastSyncedAt: leadSources.lastSyncedAt,
        createdAt: leadSources.createdAt,
      })
      .from(leadSources)
      .where(and(eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt))),
    db
      .select({
        id: connectedAccounts.id,
        platform: connectedAccounts.platform,
        accountLabel: connectedAccounts.accountLabel,
        status: connectedAccounts.status,
      })
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.companyId, session.companyId), isNull(connectedAccounts.deletedAt))),
  ]);

  return NextResponse.json({ sources: rows, accounts });
}

// Universal Webhook connector for anything that isn't OAuth-based (Google
// Lead Forms via a relay, Typeform, Gravity Forms, Jotform, WordPress,
// GoHighLevel, Zapier, Make, a plain website form, another CRM) — generates
// a secret + accepts a field mapping so arbitrary JSON payloads can be
// mapped to name/phone/email. Whether a platform belongs here is decided by
// the provider registry, not a hardcoded list: any platform with no
// registered OAuth provider (see lib/lead-sources/registry.ts) is a
// Universal Webhook source by definition, so a new push-style integration
// (another Typeform-shaped tool) never needs this file touched — only a new
// sourcePlatformEnum value. Meta (and any future OAuth provider) is
// deliberately excluded here — those connect via /api/oauth/facebook/* and
// /api/lead-sources/facebook/finalize, never a manual "paste a token" path.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { platform, name, fieldMapping } = await req.json();
  if (!platform || getProvider(platform)) {
    return NextResponse.json(
      { error: "This platform connects via OAuth, not this endpoint." },
      { status: 400 }
    );
  }

  const isWebsite = platform === "website";
  // Every connection gets a secret key. A website form's BROWSER submissions
  // (embed SDK → /api/forms/[id]) can't carry a secret and are protected by
  // honeypot + rate limits + optional CAPTCHA + origin allow-list + replay
  // guard instead; the secret exists for the OPTIONAL server-to-server post to
  // the generic webhook and so an admin can rotate it (see lib/website).
  const webhookSecret = (isWebsite ? "wsk_" : "") + crypto.randomBytes(24).toString("hex");
  const defaultName = isWebsite ? "Website Form" : platform === "google" ? "Google Lead Form" : "Generic Webhook";
  const [source] = await db
    .insert(leadSources)
    .values({
      companyId: session.companyId,
      platform,
      pageName: name || defaultName,
      webhookSecret,
      fieldMapping: fieldMapping || { name: "name", phone: "phone", email: "email" },
      status: "connected",
      createdBy: session.userId,
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
      // Website sources expose the public form endpoint + the embed snippet;
      // everything else exposes the secret-authenticated generic webhook URL.
      webhookUrl: isWebsite ? `/api/forms/${source.id}` : `/api/webhooks/generic/${source.id}`,
      formUrl: isWebsite ? `/api/forms/${source.id}` : null,
    },
  });
}
