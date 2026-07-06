// Agent presence. Deliberately simple: two columns on `users`
// (presenceStatus, lastHeartbeatAt), no separate presence table, no
// WebSockets. "Online" is derived, not just stored — a browser tab that
// stops sending heartbeats (closed, crashed, network dropped) is treated
// as unavailable the moment its heartbeat goes stale, without needing a
// background sweep job to actively flip a stored flag. This is also what
// makes reconnection automatic: the very next heartbeat updates the
// timestamp and the agent is immediately available again, with no
// separate "recovery" step to run.
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "./logger";
import { metrics } from "./infra/metrics";

export type PresenceStatus = "online" | "idle" | "busy" | "break" | "offline";

const logger = createLogger({ component: "presence" });

export async function recordHeartbeat(userId: string, status: PresenceStatus = "online"): Promise<void> {
  const [previous] = await db.select({ presenceStatus: users.presenceStatus }).from(users).where(eq(users.id, userId)).limit(1);

  await db.update(users).set({ presenceStatus: status, lastHeartbeatAt: new Date() }).where(eq(users.id, userId));

  // Only log an actual status change, not every heartbeat — at a 30s
  // interval per agent, logging every single beat would be pure noise.
  if (previous && previous.presenceStatus !== status) {
    logger.info("presence_changed", { userId, from: previous.presenceStatus, to: status });
  }
}

// Explicit status change (e.g. an agent manually sets "break") without
// necessarily being a heartbeat tick — same effect on lastHeartbeatAt,
// since setting a status is itself proof of an active tab.
export async function setPresenceStatus(userId: string, status: PresenceStatus): Promise<void> {
  return recordHeartbeat(userId, status);
}

export async function markOffline(userId: string, reason: "logged_out" | "disconnected"): Promise<void> {
  await db.update(users).set({ presenceStatus: "offline" }).where(eq(users.id, userId));
  logger.info("presence_changed", { userId, to: "offline", reason });
}

// The one function anything checking "can this agent take a lead right
// now" should call — never read presenceStatus directly, since a stale
// "online" row (heartbeat stopped, status never explicitly changed) must
// still be treated as unavailable.
export function isAgentAvailable(
  agent: { presenceStatus: PresenceStatus; lastHeartbeatAt: Date | null },
  heartbeatTimeoutSeconds: number
): boolean {
  if (agent.presenceStatus !== "online") return false;
  if (!agent.lastHeartbeatAt) return false;
  const staleSince = Date.now() - agent.lastHeartbeatAt.getTime();
  const isStale = staleSince > heartbeatTimeoutSeconds * 1000;
  if (isStale) {
    metrics.increment("presence.heartbeat_lost");
  }
  return !isStale;
}
