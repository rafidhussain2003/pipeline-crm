// The fixed lead lifecycle vocabulary (Phase 4) and the small amount of pure
// logic around it. Distinct from `disposition` (company-configurable, agent-
// facing): the lifecycle is the engine-owned progression the autonomous queue
// reasons about (what to recycle, what to rebalance, what's active).
import { WON_DISPOSITION } from "@/lib/analytics/kpis";

export type LifecycleStage =
  | "new"
  | "queued"
  | "assigned"
  | "contacted"
  | "in_progress"
  | "follow_up"
  | "won"
  | "lost"
  | "closed";

// Done — never recycled, rebalanced, or re-queued.
export const TERMINAL_STAGES: LifecycleStage[] = ["won", "lost", "closed"];

// An agent is actively working these — NEVER stolen by recycling (except when
// the owner themselves is gone) or by rebalancing.
export const ACTIVE_STAGES: LifecycleStage[] = ["contacted", "in_progress", "follow_up"];

export function isTerminalStage(stage: LifecycleStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}
export function isActiveStage(stage: LifecycleStage): boolean {
  return ACTIVE_STAGES.includes(stage);
}

// Best-effort mapping of a disposition change to a lifecycle stage, so an
// agent acting on a lead (changing its disposition) advances the lifecycle
// without a separate action. Returns null when the disposition implies no
// progression (still "New Lead"). Any non-terminal, non-New disposition means
// the agent has engaged → "contacted".
export function dispositionToLifecycle(disposition: string): LifecycleStage | null {
  if (disposition === WON_DISPOSITION) return "won";
  if (disposition === "Not Interested") return "lost";
  if (disposition === "New Lead") return null;
  return "contacted";
}
