// Agent presence. Deliberately simple: two columns on `users`
// (presenceStatus, lastHeartbeatAt), no separate presence table, no
// WebSockets. "Available" is derived, not just stored — a browser tab that
// stops sending heartbeats (closed, crashed, laptop asleep, network
// dropped, machine locked without Idle-Detection support) is treated as
// unavailable the moment its heartbeat goes stale, without needing a
// background sweep job to actively flip a stored flag. This is also what
// makes reconnection automatic: the very next heartbeat updates the
// timestamp and the agent is immediately available again, with no
// separate "recovery" step to run.
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "./logger";
import { metrics } from "./infra/metrics";

export type PresenceStatus =
  | "online"
  | "idle"
  | "busy"
  | "break"
  | "offline"
  | "away"
  | "lunch"
  | "wrap_up"
  | "locked";

// What the Team/Agents pages display — includes the derived
// "heartbeat_lost" state that is never stored (see deriveDisplayStatus).
export type DisplayPresenceStatus = PresenceStatus | "heartbeat_lost";

// The single source of truth for "can this agent receive a new lead."
// Per the assignment-engine spec, these are explicitly IGNORED: offline,
// locked, break, lunch, away — plus heartbeat-lost/disconnected, which is
// derived from staleness in isAgentAvailable() below, not a stored status.
// Everything else (online, idle, busy, wrap_up) remains eligible — the
// spec's ignore-list is exhaustive on purpose, so "busy" and "wrap_up"
// agents DO keep receiving leads (a lead lands in their queue; it is not a
// live call transfer).
export const ELIGIBLE_PRESENCE_STATUSES: PresenceStatus[] = ["online", "idle", "busy", "wrap_up"];

const logger = createLogger({ component: "presence" });

// Records a heartbeat and reports whether this heartbeat TRANSITIONED the
// agent from assignment-ineligible to assignment-eligible (offline ->
// online, lunch -> online, stale heartbeat -> fresh, ...). The caller (the
// heartbeat route) uses that signal to kick the queued-lead sweep for this
// agent's company — this is the "agent comes back, queued leads flow to
// them immediately" path, with the cron sweep as the backstop when no
// heartbeat happens to arrive right after leads queued up.
export async function recordHeartbeat(
  userId: string,
  status: PresenceStatus = "online",
  heartbeatTimeoutSeconds = 90
): Promise<{ becameAvailable: boolean; companyId: string | null }> {
  const [previous] = await db
    .select({ presenceStatus: users.presenceStatus, lastHeartbeatAt: users.lastHeartbeatAt, companyId: users.companyId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  await db.update(users).set({ presenceStatus: status, lastHeartbeatAt: new Date() }).where(eq(users.id, userId));

  // Only log an actual status change, not every heartbeat — at a 30s
  // interval per agent, logging every single beat would be pure noise.
  if (previous && previous.presenceStatus !== status) {
    logger.info("presence_changed", { userId, from: previous.presenceStatus, to: status });
  }

  const wasAvailable = previous
    ? isAgentAvailable(
        { presenceStatus: previous.presenceStatus as PresenceStatus, lastHeartbeatAt: previous.lastHeartbeatAt },
        heartbeatTimeoutSeconds
      )
    : false;
  const isNowAvailable = ELIGIBLE_PRESENCE_STATUSES.includes(status);

  return { becameAvailable: !wasAvailable && isNowAvailable, companyId: previous?.companyId ?? null };
}

// Explicit status change (e.g. an agent manually sets "break") without
// necessarily being a heartbeat tick — same effect on lastHeartbeatAt,
// since setting a status is itself proof of an active tab.
export async function setPresenceStatus(userId: string, status: PresenceStatus) {
  return recordHeartbeat(userId, status);
}

export async function markOffline(userId: string, reason: "logged_out" | "disconnected"): Promise<void> {
  await db.update(users).set({ presenceStatus: "offline" }).where(eq(users.id, userId));
  logger.info("presence_changed", { userId, to: "offline", reason });
}

// The one function anything checking "can this agent take a lead right
// now" should call — never read presenceStatus directly, since a stale
// row (heartbeat stopped, status never explicitly changed) must still be
// treated as unavailable regardless of what status it froze at.
export function isAgentAvailable(
  agent: { presenceStatus: PresenceStatus; lastHeartbeatAt: Date | null },
  heartbeatTimeoutSeconds: number
): boolean {
  if (!ELIGIBLE_PRESENCE_STATUSES.includes(agent.presenceStatus)) return false;
  if (!agent.lastHeartbeatAt) return false;
  const staleSince = Date.now() - agent.lastHeartbeatAt.getTime();
  const isStale = staleSince > heartbeatTimeoutSeconds * 1000;
  if (isStale) {
    metrics.increment("presence.heartbeat_lost");
  }
  return !isStale;
}

// What to SHOW for an agent (Team/Agents pages): the stored status, unless
// the heartbeat has gone stale while the status still claims an active
// state — then "heartbeat_lost", which is the honest answer (browser
// crashed, laptop asleep, network gone; the agent never got to tell us).
// An explicitly-offline/away/break/etc agent keeps their stored status
// even when stale — "on lunch, laptop closed" should display as Lunch, not
// Heartbeat Lost.
export function deriveDisplayStatus(
  agent: { presenceStatus: PresenceStatus; lastHeartbeatAt: Date | null },
  heartbeatTimeoutSeconds: number
): DisplayPresenceStatus {
  if (!ELIGIBLE_PRESENCE_STATUSES.includes(agent.presenceStatus)) return agent.presenceStatus;
  if (!agent.lastHeartbeatAt) return agent.presenceStatus;
  const isStale = Date.now() - agent.lastHeartbeatAt.getTime() > heartbeatTimeoutSeconds * 1000;
  return isStale ? "heartbeat_lost" : agent.presenceStatus;
}
