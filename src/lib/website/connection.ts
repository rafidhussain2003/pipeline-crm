// Website Connection helpers (Phase 8). A company's Website connection IS its
// leadSources row (platform "website"): the row id is the PUBLIC key (public,
// unguessable, safe to ship in browser JS) and webhookSecret is the SECRET key
// (for server-to-server posting to the Webhook Endpoint). This file centralizes
// key access + the small config mutations (allowed domains, rotate secret) so
// routes don't hand-roll them.
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getPublicAppUrl } from "@/lib/url";

type Source = typeof leadSources.$inferSelect;

export interface WebsiteConnection {
  websiteId: string; // = leadSources.id
  publicKey: string; // = leadSources.id (used by the browser SDK)
  secretKey: string | null; // = webhookSecret (server-to-server)
  embedEndpoint: string; // browser SDK submit URL
  webhookEndpoint: string; // server-to-server submit URL (same path, secret via header)
  sdkSnippet: string; // the one-line <script> to paste
  allowedDomains: string[];
}

export function toConnection(source: Source, baseUrl: string): WebsiteConnection {
  const meta = (source.providerMetadata ?? {}) as { allowedDomains?: string[] };
  return {
    websiteId: source.id,
    publicKey: source.id,
    secretKey: source.webhookSecret,
    embedEndpoint: `${baseUrl}/api/forms/${source.id}`, // browser SDK (public key)
    webhookEndpoint: `${baseUrl}/api/webhooks/generic/${source.id}`, // server-to-server (X-Webhook-Secret)
    sdkSnippet: `<script src="${baseUrl}/sdk/forms.js" data-key="${source.id}"></script>`,
    allowedDomains: Array.isArray(meta.allowedDomains) ? meta.allowedDomains : [],
  };
}

// Fetch a company's active Website connections.
export async function getWebsiteSources(companyId: string): Promise<Source[]> {
  return db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.companyId, companyId), eq(leadSources.platform, "website"), isNull(leadSources.deletedAt)));
}

// Return the company's Website connection, creating one if none exists yet.
// Idempotent-ish: reuses the first existing website source. Used by the hosted
// form builder so a company can publish a form without first hand-creating a
// connection on the Lead Sources page.
export async function ensureWebsiteSource(companyId: string, createdBy: string | null): Promise<Source> {
  const existing = await getWebsiteSources(companyId);
  if (existing.length > 0) return existing[0];
  const [row] = await db
    .insert(leadSources)
    .values({
      companyId,
      platform: "website",
      pageName: "Website Form",
      webhookSecret: `wsk_${randomBytes(24).toString("hex")}`,
      fieldMapping: { name: "name", phone: "phone", email: "email" },
      status: "connected",
      createdBy,
    })
    .returning();
  return row;
}

export async function getWebsiteSource(sourceId: string, companyId: string): Promise<Source | null> {
  const [row] = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.id, sourceId), eq(leadSources.companyId, companyId), eq(leadSources.platform, "website"), isNull(leadSources.deletedAt)))
    .limit(1);
  return row ?? null;
}

// Ensure a website connection has a secret key (older ones were created without
// one). Idempotent — only sets it if missing. Returns the secret.
export async function ensureSecretKey(source: Source): Promise<string> {
  if (source.webhookSecret) return source.webhookSecret;
  const secret = `wsk_${randomBytes(24).toString("hex")}`;
  await db.update(leadSources).set({ webhookSecret: secret }).where(eq(leadSources.id, source.id));
  return secret;
}

export async function rotateSecretKey(sourceId: string, companyId: string): Promise<string | null> {
  const source = await getWebsiteSource(sourceId, companyId);
  if (!source) return null;
  const secret = `wsk_${randomBytes(24).toString("hex")}`;
  await db.update(leadSources).set({ webhookSecret: secret }).where(eq(leadSources.id, sourceId));
  return secret;
}

// Update the allow-listed domains (merged into providerMetadata so the CAPTCHA
// config already stored there is preserved).
export async function updateAllowedDomains(sourceId: string, companyId: string, domains: string[]): Promise<boolean> {
  const source = await getWebsiteSource(sourceId, companyId);
  if (!source) return false;
  const meta = (source.providerMetadata ?? {}) as Record<string, unknown>;
  const clean = domains.map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")).filter(Boolean);
  await db.update(leadSources).set({ providerMetadata: { ...meta, allowedDomains: [...new Set(clean)] } }).where(eq(leadSources.id, sourceId));
  return true;
}

export function baseUrl(): string {
  return getPublicAppUrl();
}
