// Per-agent routing profile (Phase 5): capacity limits + working schedule,
// read from users.routing_config (jsonb) with safe defaults. Loaded in BULK
// per company and cached, so the scoring hot path pays at most one query per
// company per TTL. Defaults are permissive (no per-agent cap, 24/7) so
// existing agents behave exactly as before until a profile is configured.
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";

export interface AgentCapacity {
  maxActiveLeads: number | null;
  maxDailyAssignments: number | null;
  maxConcurrentConversations: number | null;
  maxQueueSize: number | null;
  maxRecycledLeads: number | null;
}

export interface AgentSchedule {
  enabled: boolean; // false = always available (24/7), the default
  timezone: string; // IANA tz
  workingDays: number[]; // 0=Sun .. 6=Sat
  startMinute: number; // minutes from local midnight
  endMinute: number;
  lunchStartMinute: number | null;
  lunchEndMinute: number | null;
  vacations: { start: string; end: string }[]; // inclusive YYYY-MM-DD ranges (also used for holidays)
}

export interface AgentProfile {
  capacity: AgentCapacity;
  schedule: AgentSchedule;
}

export const DEFAULT_AGENT_PROFILE: AgentProfile = {
  capacity: { maxActiveLeads: null, maxDailyAssignments: null, maxConcurrentConversations: null, maxQueueSize: null, maxRecycledLeads: null },
  schedule: { enabled: false, timezone: "UTC", workingDays: [1, 2, 3, 4, 5], startMinute: 0, endMinute: 24 * 60, lunchStartMinute: null, lunchEndMinute: null, vacations: [] },
};

function mergeProfile(raw: unknown): AgentProfile {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<AgentProfile>;
  return {
    capacity: { ...DEFAULT_AGENT_PROFILE.capacity, ...(o.capacity ?? {}) },
    schedule: { ...DEFAULT_AGENT_PROFILE.schedule, ...(o.schedule ?? {}) },
  };
}

// Bulk-load profiles for a company (all active agents), cached. Returns a Map
// keyed by userId; missing agents fall back to defaults at read time.
export async function getAgentProfiles(companyId: string): Promise<Map<string, AgentProfile>> {
  return cache.getOrSet(`agent-profiles:${companyId}`, 30_000, async () => {
    const rows = await db
      .select({ id: users.id, routingConfig: users.routingConfig })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.role, "agent"), isNull(users.deletedAt)));
    const m = new Map<string, AgentProfile>();
    for (const r of rows) m.set(r.id, mergeProfile(r.routingConfig));
    return m;
  });
}

export function profileFor(profiles: Map<string, AgentProfile>, agentId: string): AgentProfile {
  return profiles.get(agentId) ?? DEFAULT_AGENT_PROFILE;
}

// Local wall-clock parts for a timezone (no external deps — Intl only).
function localParts(now: Date, timezone: string): { day: number; minute: number; dateISO: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[parts.weekday] ?? 0;
  const hour = Number(parts.hour) % 24; // "24" at midnight in some locales -> 0
  const minute = hour * 60 + Number(parts.minute);
  const dateISO = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, minute, dateISO };
}

// Whether an agent is inside their working schedule right now. A disabled
// schedule is always "in". Respects working days, start/end, lunch break,
// timezone, and vacation/holiday date ranges.
export function isWithinSchedule(schedule: AgentSchedule, now: Date = new Date()): boolean {
  if (!schedule.enabled) return true;
  let parts;
  try {
    parts = localParts(now, schedule.timezone || "UTC");
  } catch {
    return true; // bad timezone config must never strand assignment
  }
  if (!schedule.workingDays.includes(parts.day)) return false;
  if (schedule.vacations.some((v) => parts.dateISO >= v.start && parts.dateISO <= v.end)) return false;
  if (parts.minute < schedule.startMinute || parts.minute >= schedule.endMinute) return false;
  if (schedule.lunchStartMinute != null && schedule.lunchEndMinute != null) {
    if (parts.minute >= schedule.lunchStartMinute && parts.minute < schedule.lunchEndMinute) return false;
  }
  return true;
}
