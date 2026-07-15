// Presence timing configuration.
//
// The heartbeat interval is what the client sends on; the away/offline
// thresholds are how the SERVER derives state from missed heartbeats. All
// configurable via env. The eligibility boundary (ONLINE -> AWAY, i.e.
// eligible -> ineligible) is per-company via the EXISTING
// automation_settings.heartbeatTimeoutSeconds column, so nothing about
// existing companies' eligibility changes.

// Client heartbeat cadence. Exposed to the browser via NEXT_PUBLIC_ so the
// client and server agree without hardcoding it in two places.
export const HEARTBEAT_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS) || 30_000;

// Default eligibility timeout used when a company hasn't customized
// automation_settings.heartbeatTimeoutSeconds. 90s is the exact value the old
// isAgentAvailable() used — keeping it means eligibility is unchanged for
// every existing company. This is the ONLINE -> AWAY boundary.
export const DEFAULT_ELIGIBILITY_TIMEOUT_SECONDS = 90;

// How far past the eligibility timeout an agent is downgraded AWAY -> OFFLINE.
// Both AWAY and OFFLINE are ineligible; this is a monitoring/label distinction
// (recently-missed vs long-gone), expressed as a multiple of the eligibility
// timeout so a company that widens its timeout widens both tiers together.
export const OFFLINE_MULTIPLIER = Number(process.env.PRESENCE_OFFLINE_MULTIPLIER) || 3;

export function offlineAfterSeconds(eligibilityTimeoutSeconds: number): number {
  return Math.max(eligibilityTimeoutSeconds, DEFAULT_ELIGIBILITY_TIMEOUT_SECONDS) * OFFLINE_MULTIPLIER;
}

// Per-company reconcile throttle: at most one time-based transition scan per
// company per this window, so a burst of heartbeats from a large company
// can't trigger a scan per heartbeat. Purely an event-emission optimization —
// eligibility is always derived fresh on read regardless.
export const RECONCILE_THROTTLE_MS = 3_000;
