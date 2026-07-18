// The Agent Presence Service — the SINGLE writer of agent presence.
//
// Nothing else in the app writes users.presenceStatus / lastHeartbeatAt; every
// other module reads presence only through this service. It owns:
//   - the durable write (users row) + the in-memory cache (store.ts),
//   - deriving the coarse 7-state model on demand (state.ts),
//   - emitting transition events (events.ts),
//   - the monitoring counters (metrics),
//   - the assignment roster + eligibility filter the engine consumes.
//
// There is NO polling loop and NO background timer. State transitions are
// derived on read (a subtraction — always current), and transition EVENTS are
// emitted at two natural moments: on a write that changes state, and via
// reconcile() (throttled) which the heartbeat route and monitoring reads call.
// Work is therefore proportional to activity, not to the number of agents.
import { db } from "@/db";
import { automationSettings, users } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";
import { metrics } from "@/lib/infra/metrics";
import { createLogger } from "@/lib/logger";
import { isAgentAvailable, type PresenceStatus } from "./status";
import { deriveState, isEligibleState, type PresenceState } from "./state";
import { DEFAULT_ELIGIBILITY_TIMEOUT_SECONDS, HEARTBEAT_INTERVAL_MS, RECONCILE_THROTTLE_MS } from "./config";
import { presenceStore } from "./store";
import { emitPresenceTransition } from "./events";
import type { PresenceEntry, PresenceView, RosterAgent } from "./types";

const logger = createLogger({ component: "presence-service" });

export interface HeartbeatInput {
  status?: PresenceStatus;
  // Client timestamp the beat was sent at (epoch ms) — used to measure
  // one-way latency. Optional; absent for legacy callers / beacons.
  sentAt?: number;
  // Client's last real user-activity time (epoch ms), for monitoring only.
  activeAt?: number;
}

export interface HeartbeatResult {
  becameAvailable: boolean;
  companyId: string | null;
  state: PresenceState;
}

class PresenceService {
  private lastReconcileAt = new Map<string, number>();

  // The eligibility (ONLINE -> AWAY) boundary for a company. Per-company via
  // the existing automation_settings.heartbeatTimeoutSeconds, cached so it is
  // not re-read on every heartbeat. Its own cache key (not the assignment
  // settings object) to stay decoupled.
  private async eligibilityTimeout(companyId: string | null): Promise<number> {
    if (!companyId) return DEFAULT_ELIGIBILITY_TIMEOUT_SECONDS;
    return cache.getOrSet(`presence-timeout:${companyId}`, 30_000, async () => {
      const [row] = await db
        .select({ t: automationSettings.heartbeatTimeoutSeconds })
        .from(automationSettings)
        .where(eq(automationSettings.companyId, companyId))
        .limit(1);
      return row?.t ?? DEFAULT_ELIGIBILITY_TIMEOUT_SECONDS;
    });
  }

  // Record a heartbeat (or an explicit status change — see setStatus). The
  // single mutation point for "an agent told us something". Returns whether
  // this transitioned the agent from ineligible to eligible, so the heartbeat
  // route can kick the queued-lead sweep (kept in the route to avoid a
  // presence -> assignment import cycle).
  async heartbeat(userId: string, input: HeartbeatInput = {}): Promise<HeartbeatResult> {
    const status: PresenceStatus = input.status ?? "online";
    const now = new Date();

    // Durable write-through (source of truth, cross-instance safe on restart),
    // fused with the previous-state read. This is the hottest write in the app
    // (every agent, every ~30s) and used to be a SELECT followed by an UPDATE —
    // two full round trips (~300-400ms each against the production database).
    // The single UPDATE ... FROM (SELECT ... FOR UPDATE) RETURNING captures the
    // old row and writes the new one atomically in one trip; FOR UPDATE keeps
    // two concurrent beats (multi-tab) from both reading the same "old" state
    // and double-reporting a transition.
    const updated = await db.execute(sql`
      UPDATE users u
      SET presence_status = ${status}, last_heartbeat_at = ${now}
      FROM (
        SELECT id, presence_status, last_heartbeat_at, company_id
        FROM users WHERE id = ${userId} FOR UPDATE
      ) old
      WHERE u.id = old.id
      RETURNING old.presence_status AS prev_status, old.last_heartbeat_at AS prev_heartbeat_at, old.company_id AS company_id
    `);
    const prevRow = (updated.rows?.[0] ?? null) as { prev_status: string; prev_heartbeat_at: string | Date | null; company_id: string | null } | null;
    const prev = prevRow
      ? {
          presenceStatus: prevRow.prev_status,
          lastHeartbeatAt: prevRow.prev_heartbeat_at ? new Date(prevRow.prev_heartbeat_at) : null,
          companyId: prevRow.company_id,
        }
      : null;

    const companyId = prev?.companyId ?? null;
    const timeout = await this.eligibilityTimeout(companyId);

    const prevState = deriveState(
      { presenceStatus: (prev?.presenceStatus as PresenceStatus) ?? "offline", lastHeartbeatAt: prev?.lastHeartbeatAt ?? null },
      timeout
    );

    const newState = deriveState({ presenceStatus: status, lastHeartbeatAt: now }, timeout);

    // Missed-beat detection: a gap much larger than the interval means beats
    // were dropped (sleep, network loss) before this one arrived.
    if (prev?.lastHeartbeatAt) {
      const gap = now.getTime() - prev.lastHeartbeatAt.getTime();
      if (gap > HEARTBEAT_INTERVAL_MS * 2) metrics.increment("presence.missed_beat");
    }
    metrics.increment("presence.heartbeat_received");

    const cachePrev = await presenceStore.get(userId);
    const cameBack = !isEligibleState(prevState) && isEligibleState(newState);
    if (cameBack) metrics.increment("presence.reconnect");

    const entry: PresenceEntry = {
      userId,
      companyId,
      status,
      lastHeartbeatAt: now,
      lastActivityAt: typeof input.activeAt === "number" ? new Date(input.activeAt) : cachePrev?.lastActivityAt ?? now,
      lastState: newState,
      reconnectCount: (cachePrev?.reconnectCount ?? 0) + (cameBack ? 1 : 0),
      lastLatencyMs: typeof input.sentAt === "number" ? Math.max(0, Date.now() - input.sentAt) : cachePrev?.lastLatencyMs ?? null,
      updatedAt: Date.now(),
    };
    await presenceStore.set(entry);

    if (newState !== prevState) {
      metrics.increment("presence.state_transition");
      if (prev && prev.presenceStatus !== status) {
        logger.info("presence_changed", { userId, from: prev.presenceStatus, to: status, state: newState });
      }
      await emitPresenceTransition(userId, companyId, prevState, newState);
    }

    return { becameAvailable: cameBack, companyId, state: newState };
  }

  // Explicit status change (agent picks "break", etc.) — same mutation path.
  async setStatus(userId: string, status: PresenceStatus): Promise<HeartbeatResult> {
    return this.heartbeat(userId, { status });
  }

  // Mark an agent gone. reason distinguishes an explicit logout (LOGGED_OUT)
  // from a dropped connection (OFFLINE) for the emitted event; both store
  // "offline" (no new enum value / migration needed).
  async markOffline(userId: string, reason: "logged_out" | "disconnected"): Promise<void> {
    const [prev] = await db
      .select({ presenceStatus: users.presenceStatus, lastHeartbeatAt: users.lastHeartbeatAt, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const companyId = prev?.companyId ?? null;
    const timeout = await this.eligibilityTimeout(companyId);
    const prevState = prev
      ? deriveState({ presenceStatus: prev.presenceStatus as PresenceStatus, lastHeartbeatAt: prev.lastHeartbeatAt }, timeout)
      : "OFFLINE";

    await db.update(users).set({ presenceStatus: "offline" }).where(eq(users.id, userId));

    const cachePrev = await presenceStore.get(userId);
    const nextState: PresenceState = reason === "logged_out" ? "LOGGED_OUT" : "OFFLINE";
    await presenceStore.set({
      userId,
      companyId,
      status: "offline",
      lastHeartbeatAt: prev?.lastHeartbeatAt ?? null,
      lastActivityAt: cachePrev?.lastActivityAt ?? null,
      lastState: nextState,
      reconnectCount: cachePrev?.reconnectCount ?? 0,
      lastLatencyMs: cachePrev?.lastLatencyMs ?? null,
      updatedAt: Date.now(),
    });

    logger.info("presence_changed", { userId, to: "offline", reason });
    if (prevState !== nextState) {
      metrics.increment("presence.state_transition");
      await emitPresenceTransition(userId, companyId, prevState, nextState);
    }
  }

  // Read one agent's current presence (from the cache, falling back to the DB
  // so a fresh instance still answers correctly).
  async getPresence(userId: string): Promise<PresenceView | null> {
    const cached = await presenceStore.get(userId);
    if (cached) {
      const timeout = await this.eligibilityTimeout(cached.companyId);
      const state = deriveState({ presenceStatus: cached.status, lastHeartbeatAt: cached.lastHeartbeatAt }, timeout);
      return { userId, companyId: cached.companyId, status: cached.status, state, lastHeartbeatAt: cached.lastHeartbeatAt, eligible: isEligibleState(state) };
    }
    const [row] = await db
      .select({ presenceStatus: users.presenceStatus, lastHeartbeatAt: users.lastHeartbeatAt, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return null;
    const timeout = await this.eligibilityTimeout(row.companyId);
    const state = deriveState({ presenceStatus: row.presenceStatus as PresenceStatus, lastHeartbeatAt: row.lastHeartbeatAt }, timeout);
    return { userId, companyId: row.companyId, status: row.presenceStatus as PresenceStatus, state, lastHeartbeatAt: row.lastHeartbeatAt, eligible: isEligibleState(state) };
  }

  // The assignment roster: all active agents for a company (role=agent,
  // active, unlocked, not deleted). Identical to the old loadActiveAgents —
  // the assignment engine consumes presence exclusively through here now.
  async getRoster(companyId: string): Promise<RosterAgent[]> {
    return db
      .select({
        id: users.id,
        tier: users.tier,
        presenceStatus: users.presenceStatus,
        lastHeartbeatAt: users.lastHeartbeatAt,
        lastAssignedAt: users.lastAssignedAt,
      })
      .from(users)
      .where(
        and(
          eq(users.companyId, companyId),
          eq(users.role, "agent"),
          eq(users.active, true),
          eq(users.locked, false),
          isNull(users.deletedAt)
        )
      );
  }

  // The presence eligibility filter, preserving the engine's original opt-in
  // behavior EXACTLY: only takes effect once at least one agent at the company
  // has ever heartbeated, and uses isAgentAvailable so the eligible set is
  // byte-for-byte what it was before.
  filterEligible(agents: RosterAgent[], eligibilityTimeoutSeconds: number) {
    const presenceInUse = agents.some((a) => a.lastHeartbeatAt !== null);
    if (!presenceInUse) return { assignable: agents, presenceInUse: false, filteredOffline: 0 };
    const assignable = agents.filter((a) => isAgentAvailable(a, eligibilityTimeoutSeconds));
    return { assignable, presenceInUse: true, filteredOffline: agents.length - assignable.length };
  }

  // Detect and emit any time-based transitions (ONLINE -> AWAY -> OFFLINE) for
  // a company's cached agents, throttled so a burst of heartbeats can't
  // trigger a scan per beat. Called by the heartbeat route (piggyback) and by
  // monitoring reads. Never a standalone timer/loop.
  async reconcile(companyId: string): Promise<void> {
    const last = this.lastReconcileAt.get(companyId) ?? 0;
    if (Date.now() - last < RECONCILE_THROTTLE_MS) return;
    this.lastReconcileAt.set(companyId, Date.now());

    const timeout = await this.eligibilityTimeout(companyId);
    const entries = await presenceStore.listByCompany(companyId);
    for (const entry of entries) {
      const current = deriveState({ presenceStatus: entry.status, lastHeartbeatAt: entry.lastHeartbeatAt }, timeout);
      if (current !== entry.lastState) {
        const prevState = entry.lastState;
        entry.lastState = current;
        entry.updatedAt = Date.now();
        await presenceStore.set(entry);
        metrics.increment("presence.state_transition");
        await emitPresenceTransition(entry.userId, companyId, prevState, current);
      }
    }
  }

  // Company presence snapshot for monitoring. Reconciles first so counts and
  // any pending transition events are current at read time.
  async getCompanySnapshot(companyId: string): Promise<PresenceView[]> {
    await this.reconcile(companyId);
    const timeout = await this.eligibilityTimeout(companyId);
    const entries = await presenceStore.listByCompany(companyId);
    return entries.map((e) => {
      const state = deriveState({ presenceStatus: e.status, lastHeartbeatAt: e.lastHeartbeatAt }, timeout);
      return { userId: e.userId, companyId: e.companyId, status: e.status, state, lastHeartbeatAt: e.lastHeartbeatAt, eligible: isEligibleState(state) };
    });
  }
}

export const presenceService = new PresenceService();
