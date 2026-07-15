// Agent Availability — the assignment engine's view of presence.
//
// Phase 2 change (required by "Assignment Engine must consume the Presence
// Service"): this no longer queries users / derives state itself. It is now a
// thin adapter over the single-writer PresenceService in src/lib/presence —
// the roster query, the eligibility filter, and the 7-state derivation all
// come from there, so the engine and the presence service can never disagree
// about who is assignable. The pipeline's call sites are unchanged; behavior
// is byte-for-byte identical (the presence service preserved the exact
// isAgentAvailable eligibility rule).
import { presenceService } from "@/lib/presence/service";
import { deriveState, isEligibleState, type PresenceState } from "@/lib/presence/state";
import type { PresenceStatus } from "@/lib/presence/status";
import type { CandidateAgent } from "./types";

// The 7 supported states now live in the presence module; this alias keeps
// the name the assignment module has always exported.
export type AvailabilityState = PresenceState;

export function isAssignableState(state: AvailabilityState): boolean {
  return isEligibleState(state);
}

export function toAvailabilityState(
  agent: { presenceStatus: PresenceStatus; lastHeartbeatAt: Date | null },
  heartbeatTimeoutSeconds: number
): AvailabilityState {
  return deriveState(agent, heartbeatTimeoutSeconds);
}

export interface AgentAvailabilityService {
  loadActiveAgents(companyId: string): Promise<CandidateAgent[]>;
  filterAssignable(
    agents: CandidateAgent[],
    heartbeatTimeoutSeconds: number
  ): { assignable: CandidateAgent[]; presenceInUse: boolean; filteredOffline: number };
  getState(
    agent: { presenceStatus: PresenceStatus; lastHeartbeatAt: Date | null },
    heartbeatTimeoutSeconds: number
  ): AvailabilityState;
}

class PresenceBackedAvailabilityService implements AgentAvailabilityService {
  loadActiveAgents(companyId: string): Promise<CandidateAgent[]> {
    return presenceService.getRoster(companyId);
  }

  filterAssignable(agents: CandidateAgent[], heartbeatTimeoutSeconds: number) {
    return presenceService.filterEligible(agents, heartbeatTimeoutSeconds);
  }

  getState(
    agent: { presenceStatus: PresenceStatus; lastHeartbeatAt: Date | null },
    heartbeatTimeoutSeconds: number
  ): AvailabilityState {
    return deriveState(agent, heartbeatTimeoutSeconds);
  }
}

export const agentAvailability: AgentAvailabilityService = new PresenceBackedAvailabilityService();
