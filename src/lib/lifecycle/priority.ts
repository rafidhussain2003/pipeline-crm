// Pluggable queue-priority scoring (Phase 4). Higher = drained first. Computed
// once at enqueue time and stored on assignment_jobs.priority, so the worker's
// ORDER BY is a cheap indexed sort. Adding a new priority signal is one line
// here + a weight in QueueConfig — no architecture change.
import type { QueueConfig } from "./config";

export interface PriorityInput {
  priority: string; // leads.priority ("high"/"normal")
  createdAt: Date;
  followUpAt: Date | null;
}

export function computeLeadPriority(lead: PriorityInput, config: QueueConfig): number {
  const w = config.priority;
  let score = 0;

  // Manual high-priority override.
  if (lead.priority === "high") score += w.manualHighBoost;

  // Fresh lead: a just-arrived lead (e.g. a live Facebook lead) should be
  // contacted while it's hot, so it jumps ahead of an aged backlog.
  const ageMinutes = (Date.now() - lead.createdAt.getTime()) / 60_000;
  if (ageMinutes <= w.freshSourceMinutes) score += w.freshSourceBoost;

  // Expired follow-up: a scheduled callback whose time has passed is urgent.
  if (lead.followUpAt && lead.followUpAt.getTime() < Date.now()) score += w.followUpExpiredBoost;

  return Math.round(score);
}
