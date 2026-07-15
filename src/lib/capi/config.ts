// Phase 11 — CAPI configuration access: a company's active pixels and each
// pixel's trigger→event mappings, cached (short TTL) so the hot event path
// never re-queries them per event. Token resolution decrypts the pixel's own
// send token, falling back to the reused connected-account OAuth token.
import { db } from "@/db";
import { capiPixels, capiEventMappings, connectedAccounts } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { decrypt } from "@/lib/crypto";
import type { MappingRow } from "./mapping";

export type PixelConfig = typeof capiPixels.$inferSelect;

const PIXELS_TTL = 60_000;
const MAPPINGS_TTL = 60_000;

export async function getActivePixels(companyId: string): Promise<PixelConfig[]> {
  return cache.getOrSet(`capi-pixels:${companyId}`, PIXELS_TTL, async () =>
    db.select().from(capiPixels).where(and(eq(capiPixels.companyId, companyId), eq(capiPixels.active, true), isNull(capiPixels.deletedAt)))
  );
}

export async function getPixel(pixelConfigId: string, companyId: string): Promise<PixelConfig | null> {
  const [row] = await db
    .select()
    .from(capiPixels)
    .where(and(eq(capiPixels.id, pixelConfigId), eq(capiPixels.companyId, companyId), isNull(capiPixels.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getMappings(pixelConfigId: string): Promise<MappingRow[]> {
  return cache.getOrSet(`capi-mappings:${pixelConfigId}`, MAPPINGS_TTL, async () => {
    const rows = await db
      .select({ trigger: capiEventMappings.trigger, metaEvent: capiEventMappings.metaEvent, enabled: capiEventMappings.enabled })
      .from(capiEventMappings)
      .where(eq(capiEventMappings.pixelId, pixelConfigId));
    return rows as MappingRow[];
  });
}

export function invalidatePixelCache(companyId: string): void {
  void cache.delete(`capi-pixels:${companyId}`);
}
export function invalidateMappingCache(pixelConfigId: string): void {
  void cache.delete(`capi-mappings:${pixelConfigId}`);
}

// The token used to POST events for a pixel: the pixel's own token if set,
// otherwise the reused OAuth token on its connected account. Returns null when
// neither is available (nothing to send with — surfaced in diagnostics).
export async function resolveSendToken(pixel: PixelConfig): Promise<string | null> {
  if (pixel.accessToken) {
    try {
      return decrypt(pixel.accessToken);
    } catch {
      /* fall through to account token */
    }
  }
  if (pixel.accountId) {
    const [acct] = await db.select({ token: connectedAccounts.accessToken }).from(connectedAccounts).where(eq(connectedAccounts.id, pixel.accountId)).limit(1);
    if (acct?.token) {
      try {
        return decrypt(acct.token);
      } catch {
        return null;
      }
    }
  }
  return null;
}
