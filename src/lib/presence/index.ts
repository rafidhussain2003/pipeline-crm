// Public surface of the Agent Presence Service module.
//
// Replaces the old single-file src/lib/presence.ts. It keeps that file's
// import surface working (so existing callers don't change) while routing all
// WRITES through the new single-writer PresenceService — satisfying "nothing
// except this service should update agent presence." The old function names
// are now thin facades over the service.
import { presenceService, type HeartbeatInput } from "./service";
import type { PresenceStatus } from "./status";

// --- Pure primitives + types (unchanged, re-exported) ---
export {
  ELIGIBLE_PRESENCE_STATUSES,
  isAgentAvailable,
  deriveDisplayStatus,
} from "./status";
export type { PresenceStatus, DisplayPresenceStatus } from "./status";

// --- New Phase 2 surface for new consumers ---
export { presenceService } from "./service";
export type { HeartbeatInput, HeartbeatResult } from "./service";
export { deriveState, isEligibleState } from "./state";
export type { PresenceState } from "./state";
export { getPresenceMetrics } from "./metrics";
export type { PresenceView, RosterAgent } from "./types";

// --- Backward-compatible facades over the service ---

// The old recordHeartbeat(userId, status, heartbeatTimeoutSeconds). The
// timeout arg is now ignored (the service derives the per-company boundary
// itself), but the signature and { becameAvailable, companyId } return are
// preserved so the heartbeat route and any other caller keep working.
export async function recordHeartbeat(
  userId: string,
  status: PresenceStatus = "online",
  _heartbeatTimeoutSeconds?: number,
  extra?: HeartbeatInput
): Promise<{ becameAvailable: boolean; companyId: string | null }> {
  const { becameAvailable, companyId } = await presenceService.heartbeat(userId, { status, ...extra });
  return { becameAvailable, companyId };
}

export async function setPresenceStatus(userId: string, status: PresenceStatus) {
  return presenceService.setStatus(userId, status);
}

export async function markOffline(userId: string, reason: "logged_out" | "disconnected"): Promise<void> {
  return presenceService.markOffline(userId, reason);
}
