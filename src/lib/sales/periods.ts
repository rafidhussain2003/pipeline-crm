// Sales Ledger — per-month agent visibility.
//
// For each month an admin can set a cutoff date: after it, AGENTS see that
// month as summary-only (no customer detail, no editing). This reads the cutoff
// through a short-TTL cache (like getManagerPrivacyMode) so the hot path — every
// agent request that must decide detail-vs-summary — isn't a DB round trip.
//
// The cutoff is cached as epoch-ms (not a Date) so the value stays correct if
// the cache is ever swapped for a serializing backend (Redis).
import { db } from "@/db";
import { salesPeriodSettings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { isSchemaLagError } from "@/lib/db-errors";

const TTL = 30_000;
const cacheKey = (companyId: string, month: string) => `sales-period:${companyId}:${month}`;

export type PeriodSetting = { agentVisibleUntilMs: number | null };

export async function getPeriodSetting(companyId: string, month: string): Promise<PeriodSetting> {
  try {
    return await cache.getOrSet(cacheKey(companyId, month), TTL, async () => {
      const [row] = await db
        .select({ agentVisibleUntil: salesPeriodSettings.agentVisibleUntil })
        .from(salesPeriodSettings)
        .where(and(eq(salesPeriodSettings.companyId, companyId), eq(salesPeriodSettings.month, month)))
        .limit(1);
      return { agentVisibleUntilMs: row?.agentVisibleUntil ? row.agentVisibleUntil.getTime() : null };
    });
  } catch (err) {
    // Migration lag (sales_period_settings ships in 0050): treat a missing
    // table as "no cutoff set" — agents keep seeing detail — rather than 500
    // the whole ledger. Self-heals once the boot migrator lands the table.
    if (!isSchemaLagError(err)) throw err;
    console.error("[sales-periods] sales_period_settings missing — migration 0050 not applied yet");
    return { agentVisibleUntilMs: null };
  }
}

export function invalidatePeriodSetting(companyId: string, month: string): Promise<void> {
  return cache.delete(cacheKey(companyId, month));
}
