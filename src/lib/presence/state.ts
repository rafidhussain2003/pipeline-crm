// The 7 SUPPORTED AGENT STATES — the coarse, DERIVED availability vocabulary
// the presence service and the assignment engine reason about, distinct from
// the raw PresenceStatus stored on the row (status.ts). "Derived" means it is
// a pure function of the stored status + heartbeat freshness + now: an agent
// transitions ONLINE -> AWAY -> OFFLINE purely by the passage of time, with no
// write and no background job needed.
import { ELIGIBLE_PRESENCE_STATUSES, isAgentAvailable, type PresenceStatus } from "./status";
import { offlineAfterSeconds } from "./config";

export type PresenceState = "ONLINE" | "OFFLINE" | "AWAY" | "BUSY" | "LOCKED" | "LOGGED_OUT" | "UNKNOWN";

// Only these two can receive a new lead. Identical to isAgentAvailable's
// eligible set (online/idle -> ONLINE, busy/wrap_up -> BUSY while fresh) — so
// "never assign to OFFLINE/LOCKED/LOGGED_OUT/UNKNOWN/AWAY" is exactly today's
// eligibility, just expressed in the richer vocabulary.
const ASSIGNABLE_STATES: ReadonlySet<PresenceState> = new Set<PresenceState>(["ONLINE", "BUSY"]);

export function isEligibleState(state: PresenceState): boolean {
  return ASSIGNABLE_STATES.has(state);
}

export interface PresenceInput {
  presenceStatus: PresenceStatus;
  lastHeartbeatAt: Date | null;
}

// Derive the coarse state from the raw status + heartbeat freshness.
//
// eligibilityTimeoutSeconds is the ONLINE -> AWAY (eligible -> ineligible)
// boundary; it defaults per-company from automation_settings, so the point at
// which an agent stops being assignable is UNCHANGED from before. The ONLINE/
// BUSY decision is delegated to isAgentAvailable() so it is byte-for-byte the
// same predicate the old engine used; AWAY/OFFLINE/LOCKED/LOGGED_OUT/UNKNOWN
// are layered on top for monitoring and events only (all ineligible).
export function deriveState(input: PresenceInput, eligibilityTimeoutSeconds: number): PresenceState {
  const { presenceStatus: status, lastHeartbeatAt } = input;

  // Explicit non-active statuses win, honored as-is even when stale.
  if (status === "locked") return "LOCKED";
  if (status === "break" || status === "lunch" || status === "away") return "AWAY";
  if (status === "offline") return lastHeartbeatAt ? "OFFLINE" : "LOGGED_OUT";

  // Active statuses (online/idle/busy/wrap_up).
  if (ELIGIBLE_PRESENCE_STATUSES.includes(status)) {
    if (!lastHeartbeatAt) return "UNKNOWN"; // claims active but never proved it
    if (isAgentAvailable(input, eligibilityTimeoutSeconds)) {
      return status === "busy" || status === "wrap_up" ? "BUSY" : "ONLINE";
    }
    // Past the eligibility timeout -> ineligible; tier the label by staleness.
    const ageSeconds = (Date.now() - lastHeartbeatAt.getTime()) / 1000;
    return ageSeconds < offlineAfterSeconds(eligibilityTimeoutSeconds) ? "AWAY" : "OFFLINE";
  }

  return "UNKNOWN";
}
