// Operations Center — automatic warning engine. Pure function over the raw
// signals the snapshot already gathered (no extra queries, no configuration):
// it just classifies the current situation into simple warning cards.
export type WarningLevel = "critical" | "warning" | "info";

export interface OpsWarning {
  level: WarningLevel;
  title: string;
  detail: string;
}

export interface WarningSignals {
  onlineOrBusyAgents: number;
  totalAgents: number;
  queueSize: number;
  oldestWaitSeconds: number | null;
  deadLetterCount: number;
  overdueSlaCount: number;
  deliveryFailuresToday: number;
  failedJobs: number;
}

export function deriveWarnings(s: WarningSignals): OpsWarning[] {
  const w: OpsWarning[] = [];

  // No one to take leads — the single most important operational alarm.
  if (s.totalAgents > 0 && s.onlineOrBusyAgents === 0) {
    w.push({ level: s.queueSize > 0 ? "critical" : "warning", title: "No agents online", detail: s.queueSize > 0 ? `${s.queueSize} lead(s) waiting with nobody available.` : "No agents are currently available to receive leads." });
  }

  // Queue congestion / large backlog.
  if (s.queueSize >= 200) w.push({ level: "critical", title: "Queue congestion", detail: `${s.queueSize} leads are waiting to be assigned.` });
  else if (s.queueSize >= 50) w.push({ level: "warning", title: "Queue building up", detail: `${s.queueSize} leads are waiting to be assigned.` });

  if (s.oldestWaitSeconds != null && s.oldestWaitSeconds >= 30 * 60) {
    w.push({ level: "warning", title: "Leads waiting too long", detail: `The oldest queued lead has waited ${Math.round(s.oldestWaitSeconds / 60)} min.` });
  }

  // SLA breaches.
  if (s.overdueSlaCount > 0) {
    w.push({ level: s.overdueSlaCount >= 10 ? "critical" : "warning", title: "SLA breaches", detail: `${s.overdueSlaCount} lead(s) are past their assignment SLA.` });
  }

  // Assignment failures piling up (retried/dead-lettered jobs).
  if (s.deadLetterCount > 0) {
    w.push({ level: s.deadLetterCount >= 20 ? "critical" : "warning", title: "Assignment failures", detail: `${s.deadLetterCount} assignment(s) exhausted retries (dead-lettered).` });
  } else if (s.failedJobs >= 20) {
    w.push({ level: "warning", title: "High retry activity", detail: `${s.failedJobs} assignment(s) are retrying.` });
  }

  // Lead delivery (Meta/webhook) failures today.
  if (s.deliveryFailuresToday > 0) {
    w.push({ level: s.deliveryFailuresToday >= 10 ? "critical" : "warning", title: "Lead delivery failures", detail: `${s.deliveryFailuresToday} inbound delivery failure(s) today.` });
  }

  return w;
}
