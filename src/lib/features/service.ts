// Phase 18 — the ONE feature resolver. Every module checks entitlement
// through here (featureService.isEnabled), never with its own lookup, so
// there is exactly one definition of "does this company have this module".
//
// Performance: a company's resolved map is one PK jsonb read, cached for 60s
// and invalidated on write — at 10,000 companies that is at most 10k tiny
// cache entries and one DB read per company per minute worst-case; the
// millions of per-request checks in between are in-memory map hits.
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { recordAudit } from "@/lib/audit";
import { defaultFeatureMap, featureDef, isKnownFeature, type FeatureKey } from "./registry";

const TTL = 60_000;
const cacheKey = (companyId: string) => `features:${companyId}`;

export type FeatureMap = Record<string, boolean>;

// Overrides merged over registry defaults. Unknown keys in a stored blob are
// ignored (a feature later removed from the registry can't resurrect), and a
// feature ADDED to the registry after a company saved its profile resolves to
// the new feature's default — future modules need no backfill.
function resolve(stored: unknown): FeatureMap {
  const map = defaultFeatureMap();
  if (stored && typeof stored === "object") {
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof value === "boolean" && isKnownFeature(key)) map[key] = value;
    }
  }
  // Core modules are always on, regardless of what a stored blob claims.
  for (const key of Object.keys(map)) if (featureDef(key)?.core) map[key] = true;
  return map;
}

export async function getEnabledFeatures(companyId: string): Promise<FeatureMap> {
  return cache.getOrSet(cacheKey(companyId), TTL, async () => {
    const [row] = await db.select({ f: companies.enabledFeatures }).from(companies).where(eq(companies.id, companyId)).limit(1);
    return resolve(row?.f ?? null);
  });
}

export async function isFeatureEnabled(companyId: string, feature: FeatureKey | string): Promise<boolean> {
  const map = await getEnabledFeatures(companyId);
  return map[feature] === true;
}

// Platform-Owner write path: apply a patch of { feature: boolean }, audit each
// actual CHANGE as its own row (owner, company, feature, enabled/disabled,
// timestamp), and invalidate the cache so it takes effect immediately.
export async function setCompanyFeatures(
  companyId: string,
  patch: Record<string, boolean>,
  actor: { userId: string },
): Promise<FeatureMap> {
  const entries = Object.entries(patch).filter(([k, v]) => typeof v === "boolean" && isKnownFeature(k));
  if (entries.length === 0) return getEnabledFeatures(companyId);
  for (const [key] of entries) {
    if (featureDef(key)?.core) throw new Error(`"${featureDef(key)!.label}" is a core module and cannot be toggled.`);
  }

  const [row] = await db.select({ f: companies.enabledFeatures }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!row) throw new Error("Company not found");
  const before = resolve(row.f ?? null);

  const stored = (row.f && typeof row.f === "object" ? { ...(row.f as Record<string, unknown>) } : {}) as Record<string, boolean>;
  for (const [key, value] of entries) stored[key] = value;
  await db.update(companies).set({ enabledFeatures: stored, updatedAt: new Date() }).where(eq(companies.id, companyId));
  await cache.delete(cacheKey(companyId));

  const after = resolve(stored);
  for (const [key] of entries) {
    if (before[key] !== after[key]) {
      await recordAudit({
        companyId,
        userId: actor.userId,
        action: after[key] ? "feature.enabled" : "feature.disabled",
        entityType: "company_feature",
        entityId: companyId,
        metadata: { feature: key, label: featureDef(key)?.label ?? key },
      });
    }
  }
  return after;
}

// The service object the spec names — one import surface for every module.
export const featureService = {
  isEnabled: isFeatureEnabled,
  getEnabled: getEnabledFeatures,
  setFeatures: setCompanyFeatures,
};
