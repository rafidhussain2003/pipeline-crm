// Phase 4 queue/lifecycle configuration — every tunable in one typed place,
// "no hardcoded values". Defaults in code; a per-company override lives in the
// automation_settings.queue_config jsonb, merged over the defaults and also
// pulling the pre-existing recycle knobs (recycleAfterMinutes, maxRecycleCount,
// autoRecycleEnabled) off automation_settings so existing config keeps working.
// Cached (30s) so reading it in the hot path costs nothing after the first.
import { db } from "@/db";
import { automationSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";

export interface QueueConfig {
  // Recovery: a job left "processing" longer than this (worker crashed mid-
  // assignment) is reclaimed to pending. This is the lead reservation timeout.
  reservationTimeoutSeconds: number;
  // Max attempts before a job is dead-lettered.
  maxRetries: number;
  recycle: {
    enabled: boolean;
    slaMinutes: number; // assigned-but-not-contacted SLA
    untouchedMinutes: number; // no update for this long (from automation_settings.recycleAfterMinutes)
    agentOfflineMinutes: number; // owner offline/stale this long
    recycleActiveLeads: boolean; // recycle contacted/in_progress leads too (default: never)
    maxRecycleCount: number; // hard cap per lead (from automation_settings.maxRecycleCount)
  };
  rebalance: {
    enabled: boolean;
    minImbalance: number; // act only when (max open - min open) across eligible agents >= this
    maxMovesPerRun: number; // bound leads moved per company per run
  };
  priority: {
    manualHighBoost: number; // lead.priority === "high"
    freshSourceBoost: number; // recently-created lead
    freshSourceMinutes: number;
    followUpExpiredBoost: number; // followUpAt in the past
    vipBoost: number; // reserved for a future VIP signal
  };
  // Phase 5 assignment SLAs — time-to-assign targets (seconds) per lead class,
  // and the priority boost applied to an overdue queued lead.
  sla: {
    vipSeconds: number;
    freshSeconds: number;
    businessSeconds: number;
    defaultSeconds: number;
    escalationPriorityBoost: number;
  };
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  reservationTimeoutSeconds: 120,
  maxRetries: 10,
  recycle: {
    enabled: false, // gated by automation_settings.autoRecycleEnabled unless overridden
    slaMinutes: 30,
    untouchedMinutes: 1440,
    agentOfflineMinutes: 15,
    recycleActiveLeads: false,
    maxRecycleCount: 5,
  },
  rebalance: {
    enabled: false, // opt-in: moving leads between agents is visible, so off by default
    minImbalance: 15,
    maxMovesPerRun: 10,
  },
  priority: {
    manualHighBoost: 100,
    freshSourceBoost: 50,
    freshSourceMinutes: 10,
    followUpExpiredBoost: 40,
    vipBoost: 80,
  },
  sla: {
    vipSeconds: 10,
    freshSeconds: 30,
    businessSeconds: 60,
    defaultSeconds: 60,
    escalationPriorityBoost: 200,
  },
};

type Override = {
  reservationTimeoutSeconds?: number;
  maxRetries?: number;
  recycle?: Partial<QueueConfig["recycle"]>;
  rebalance?: Partial<QueueConfig["rebalance"]>;
  priority?: Partial<QueueConfig["priority"]>;
  sla?: Partial<QueueConfig["sla"]>;
};

const key = (companyId: string) => `queue-config:${companyId}`;

export async function getQueueConfig(companyId: string): Promise<QueueConfig> {
  return cache.getOrSet(key(companyId), 30_000, async () => {
    const [row] = await db
      .select({
        recycleAfterMinutes: automationSettings.recycleAfterMinutes,
        maxRecycleCount: automationSettings.maxRecycleCount,
        autoRecycleEnabled: automationSettings.autoRecycleEnabled,
        queueConfig: automationSettings.queueConfig,
      })
      .from(automationSettings)
      .where(eq(automationSettings.companyId, companyId))
      .limit(1);

    const o = (row?.queueConfig as Override | null) ?? {};
    const base = DEFAULT_QUEUE_CONFIG;
    return {
      reservationTimeoutSeconds: o.reservationTimeoutSeconds ?? base.reservationTimeoutSeconds,
      maxRetries: o.maxRetries ?? base.maxRetries,
      recycle: {
        // Existing automation_settings drive the defaults so nothing about
        // current companies changes; the jsonb override wins if present.
        enabled: o.recycle?.enabled ?? row?.autoRecycleEnabled ?? base.recycle.enabled,
        slaMinutes: o.recycle?.slaMinutes ?? base.recycle.slaMinutes,
        untouchedMinutes: o.recycle?.untouchedMinutes ?? row?.recycleAfterMinutes ?? base.recycle.untouchedMinutes,
        agentOfflineMinutes: o.recycle?.agentOfflineMinutes ?? base.recycle.agentOfflineMinutes,
        recycleActiveLeads: o.recycle?.recycleActiveLeads ?? base.recycle.recycleActiveLeads,
        maxRecycleCount: o.recycle?.maxRecycleCount ?? row?.maxRecycleCount ?? base.recycle.maxRecycleCount,
      },
      rebalance: { ...base.rebalance, ...(o.rebalance ?? {}) },
      priority: { ...base.priority, ...(o.priority ?? {}) },
      sla: { ...base.sla, ...(o.sla ?? {}) },
    };
  });
}

// Update a company's queue config (merges over any existing override) — for a
// future admin API / tests; invalidates the cache so it takes effect at once.
export async function updateQueueConfig(companyId: string, patch: Override): Promise<void> {
  const [row] = await db.select({ q: automationSettings.queueConfig }).from(automationSettings).where(eq(automationSettings.companyId, companyId)).limit(1);
  const existing = (row?.q as Override | null) ?? {};
  const next: Override = {
    ...existing,
    ...patch,
    recycle: { ...(existing.recycle ?? {}), ...(patch.recycle ?? {}) },
    rebalance: { ...(existing.rebalance ?? {}), ...(patch.rebalance ?? {}) },
    priority: { ...(existing.priority ?? {}), ...(patch.priority ?? {}) },
    sla: { ...(existing.sla ?? {}), ...(patch.sla ?? {}) },
  };
  await db.update(automationSettings).set({ queueConfig: next }).where(eq(automationSettings.companyId, companyId));
  await cache.delete(key(companyId));
}
