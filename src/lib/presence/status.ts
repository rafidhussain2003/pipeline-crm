// Raw presence STATUS vocabulary + the eligibility primitives.
//
// This is the low-level layer: the statuses an agent's row can hold
// (self-reported by the client or written by the service) and the pure,
// proven "can this agent take a lead right now" predicate. Moved verbatim
// from the old src/lib/presence.ts so eligibility is byte-for-byte
// unchanged — the Phase 2 service layer (state.ts / service.ts) builds the
// richer 7-state model and events ON TOP of these, it does not alter them.
//
// One deliberate change: isAgentAvailable() is now a PURE predicate. The old
// version incremented a "heartbeat_lost" metric as a side effect, which was
// fine when called once per assignment but would over-count now that
// deriveState() reads it on every presence read. That metric is now emitted
// by the service on an actual ONLINE -> lost TRANSITION (see service.ts).

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

// What the Team/Agents pages display — includes the derived "heartbeat_lost"
// state that is never stored (see deriveDisplayStatus). Kept for the existing
// UI, unchanged.
export type DisplayPresenceStatus = PresenceStatus | "heartbeat_lost";

// The single source of truth for "which raw statuses are assignment-eligible
// once their heartbeat is fresh." Per the assignment-engine spec these are
// IGNORED: offline, locked, break, lunch, away — plus heartbeat-lost, which
// is derived from staleness in isAgentAvailable() below. online/idle/busy/
// wrap_up remain eligible (a lead lands in their queue; it is not a live
// call transfer).
export const ELIGIBLE_PRESENCE_STATUSES: PresenceStatus[] = ["online", "idle", "busy", "wrap_up"];

// The one predicate anything checking "can this agent take a lead right now"
// should call — never read presenceStatus directly, since a stale row
// (heartbeat stopped, status never explicitly changed) must still be treated
// as unavailable regardless of what status it froze at.
export function isAgentAvailable(
  agent: { presenceStatus: PresenceStatus; lastHeartbeatAt: Date | null },
  heartbeatTimeoutSeconds: number
): boolean {
  if (!ELIGIBLE_PRESENCE_STATUSES.includes(agent.presenceStatus)) return false;
  if (!agent.lastHeartbeatAt) return false;
  const staleSince = Date.now() - agent.lastHeartbeatAt.getTime();
  return staleSince <= heartbeatTimeoutSeconds * 1000;
}

// What to SHOW for an agent (Team/Agents pages): the stored status, unless
// the heartbeat has gone stale while the status still claims an active state
// — then "heartbeat_lost". An explicitly-offline/away/break/etc agent keeps
// their stored status even when stale. Unchanged from the old module.
export function deriveDisplayStatus(
  agent: { presenceStatus: PresenceStatus; lastHeartbeatAt: Date | null },
  heartbeatTimeoutSeconds: number
): DisplayPresenceStatus {
  if (!ELIGIBLE_PRESENCE_STATUSES.includes(agent.presenceStatus)) return agent.presenceStatus;
  if (!agent.lastHeartbeatAt) return agent.presenceStatus;
  const isStale = Date.now() - agent.lastHeartbeatAt.getTime() > heartbeatTimeoutSeconds * 1000;
  return isStale ? "heartbeat_lost" : agent.presenceStatus;
}
