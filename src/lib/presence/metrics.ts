// Presence monitoring (Phase 2 — collection only, no UI).
//
// Live GAUGES (current online/away/busy/locked/... counts) are derived on
// demand from the in-memory store — no DB scan, no polling. Process-lifetime
// COUNTERS (heartbeats received/lost/restored, reconnects, missed beats) come
// from the in-memory metrics registry. Heartbeat latency is averaged over the
// last-seen latency of each tracked agent.
import { presenceStore } from "./store";
import { deriveState, isEligibleState } from "./state";
import { DEFAULT_ELIGIBILITY_TIMEOUT_SECONDS } from "./config";
import { metrics } from "@/lib/infra/metrics";

export interface PresenceMetricsSnapshot {
  // Current live counts (gauges), derived fresh from the store.
  counts: {
    online: number;
    busy: number;
    away: number;
    locked: number;
    offline: number;
    loggedOut: number;
    unknown: number;
    eligible: number; // online + busy — the assignable pool
  };
  // Process-lifetime counters (reset on restart).
  counters: {
    heartbeatsReceived: number;
    heartbeatsLost: number;
    heartbeatsRestored: number;
    reconnects: number;
    missedBeats: number;
  };
  avgHeartbeatLatencyMs: number | null;
  trackedAgents: number;
}

export async function getPresenceMetrics(companyId?: string): Promise<PresenceMetricsSnapshot> {
  const entries = companyId ? await presenceStore.listByCompany(companyId) : await presenceStore.all();

  const counts = { online: 0, busy: 0, away: 0, locked: 0, offline: 0, loggedOut: 0, unknown: 0, eligible: 0 };
  let latencySum = 0;
  let latencyN = 0;

  for (const e of entries) {
    const state = deriveState({ presenceStatus: e.status, lastHeartbeatAt: e.lastHeartbeatAt }, DEFAULT_ELIGIBILITY_TIMEOUT_SECONDS);
    switch (state) {
      case "ONLINE": counts.online++; break;
      case "BUSY": counts.busy++; break;
      case "AWAY": counts.away++; break;
      case "LOCKED": counts.locked++; break;
      case "OFFLINE": counts.offline++; break;
      case "LOGGED_OUT": counts.loggedOut++; break;
      case "UNKNOWN": counts.unknown++; break;
    }
    if (isEligibleState(state)) counts.eligible++;
    if (e.lastLatencyMs != null) {
      latencySum += e.lastLatencyMs;
      latencyN++;
    }
  }

  const snap = metrics.snapshot();
  return {
    counts,
    counters: {
      heartbeatsReceived: snap["presence.heartbeat_received"],
      heartbeatsLost: snap["presence.heartbeat_lost"],
      heartbeatsRestored: snap["presence.heartbeat_restored"],
      reconnects: snap["presence.reconnect"],
      missedBeats: snap["presence.missed_beat"],
    },
    avgHeartbeatLatencyMs: latencyN ? Math.round(latencySum / latencyN) : null,
    trackedAgents: entries.length,
  };
}
