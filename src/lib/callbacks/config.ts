// Phase 15 — per-company callback configuration (smart reminder offsets +
// escalation). Cached with a short TTL so the reminder worker never re-queries
// settings per row. Falls back to sensible defaults when a company has no row,
// so the engine works out of the box.
import { db } from "@/db";
import { callbackSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";

export interface CallbackSettings {
  reminderOffsets: number[]; // minutes relative to scheduledAt
  escalateAfterMinutes: number;
  notifyManager: boolean;
  notifyAdmin: boolean;
  soundEnabled: boolean;
}

export const DEFAULT_CALLBACK_SETTINGS: CallbackSettings = {
  reminderOffsets: [-15, -5, 0, 15, 60],
  escalateAfterMinutes: 30,
  notifyManager: true,
  notifyAdmin: false,
  soundEnabled: true,
};

const TTL = 60_000;

export async function getCallbackSettings(companyId: string): Promise<CallbackSettings> {
  return cache.getOrSet(`callback-settings:${companyId}`, TTL, async () => {
    const [row] = await db.select().from(callbackSettings).where(eq(callbackSettings.companyId, companyId)).limit(1);
    if (!row) return DEFAULT_CALLBACK_SETTINGS;
    const offsets = Array.isArray(row.reminderOffsets) ? (row.reminderOffsets as unknown[]).filter((n): n is number => typeof n === "number") : DEFAULT_CALLBACK_SETTINGS.reminderOffsets;
    return {
      reminderOffsets: offsets.length > 0 ? offsets : DEFAULT_CALLBACK_SETTINGS.reminderOffsets,
      escalateAfterMinutes: row.escalateAfterMinutes,
      notifyManager: row.notifyManager,
      notifyAdmin: row.notifyAdmin,
      soundEnabled: row.soundEnabled,
    };
  });
}

// Offsets must be minutes within ±24h of the scheduled time. Sanitizing to an
// EMPTY list would silently switch that company's reminders off entirely, so a
// caller who supplies offsets but none survive validation gets an error instead.
function sanitizeOffsets(input: number[]): number[] {
  const clean = [...new Set(input.filter((n) => Number.isFinite(n) && n >= -1440 && n <= 1440).map((n) => Math.trunc(n)))].sort((a, b) => a - b);
  if (clean.length === 0) throw new Error("Reminder offsets must be minutes between -1440 and 1440 relative to the callback time.");
  return clean;
}

export async function updateCallbackSettings(companyId: string, patch: Partial<CallbackSettings>): Promise<CallbackSettings> {
  const current = await getCallbackSettings(companyId);
  const next: CallbackSettings = {
    reminderOffsets: Array.isArray(patch.reminderOffsets) && patch.reminderOffsets.length > 0
      ? sanitizeOffsets(patch.reminderOffsets)
      : current.reminderOffsets,
    escalateAfterMinutes: Number.isFinite(patch.escalateAfterMinutes) ? Math.max(1, Math.min(1440, Math.trunc(patch.escalateAfterMinutes as number))) : current.escalateAfterMinutes,
    notifyManager: patch.notifyManager ?? current.notifyManager,
    notifyAdmin: patch.notifyAdmin ?? current.notifyAdmin,
    soundEnabled: patch.soundEnabled ?? current.soundEnabled,
  };
  await db
    .insert(callbackSettings)
    .values({ companyId, ...next })
    .onConflictDoUpdate({ target: callbackSettings.companyId, set: { ...next, updatedAt: new Date() } });
  void cache.delete(`callback-settings:${companyId}`);
  return next;
}
