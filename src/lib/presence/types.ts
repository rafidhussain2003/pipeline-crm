import type { PresenceStatus } from "./status";
import type { PresenceState } from "./state";

// The assignment-roster shape. Structurally identical to the assignment
// module's CandidateAgent, defined HERE so the presence service (which owns
// the roster query) never imports from the assignment module — keeping the
// dependency one-directional (assignment -> presence) with no cycle.
export interface RosterAgent {
  id: string;
  tier: string | null;
  presenceStatus: PresenceStatus;
  lastHeartbeatAt: Date | null;
  lastAssignedAt: Date | null;
}

// One agent's live presence as tracked by the service's in-memory cache.
export interface PresenceEntry {
  userId: string;
  companyId: string | null;
  status: PresenceStatus;
  lastHeartbeatAt: Date | null;
  lastActivityAt: Date | null;
  // The last derived state we EMITTED an event for. reconcile() compares the
  // freshly-derived state against this to detect time-based transitions
  // (ONLINE -> AWAY -> OFFLINE) without any polling loop.
  lastState: PresenceState;
  // Incremented each time this agent comes back from an ineligible/gone state
  // — the "reconnect count" monitoring metric.
  reconnectCount: number;
  lastLatencyMs: number | null;
  updatedAt: number; // epoch ms of the last write to this entry
}

// A read-friendly projection returned by the service's read methods.
export interface PresenceView {
  userId: string;
  companyId: string | null;
  status: PresenceStatus;
  state: PresenceState;
  lastHeartbeatAt: Date | null;
  eligible: boolean;
}
