import type { CandidateAgent } from "../types";

// Shared selection primitives. Ported verbatim from the original
// chooseAgent() so every strategy produces byte-for-byte the same choice the
// monolithic engine did — this is the one place tie-break discipline lives.

export const tierOf = (a: CandidateAgent): string => a.tier || "1";

// How long an agent has been idle (waiting for a lead). No prior assignment
// = "waited forever" so a brand-new agent is preferred by idle-based modes.
export const idleMs = (a: CandidateAgent): number =>
  a.lastAssignedAt ? Date.now() - a.lastAssignedAt.getTime() : Number.MAX_SAFE_INTEGER;

// Build a rotation cycle (each agent appearing `weight` times) and pick the
// cursor'th slot — the fair, stateless-per-call core of every rotation mode.
export async function rotateWeighted(
  agents: CandidateAgent[],
  weightFn: (a: CandidateAgent) => number,
  advanceCursor: () => Promise<number>
): Promise<string> {
  const sorted = [...agents].sort((a, b) => tierOf(a).localeCompare(tierOf(b)) || a.id.localeCompare(b.id));
  // The cycle is built with Smooth Weighted Round Robin (see below) rather
  // than block repetition. It is the SAME MULTISET either way — each agent
  // still appears exactly max(1, weight) times — so the cycle length, the
  // weighted totals over a full period, and the cursor math below
  // (cycle[(cursor-1) % length]) are all byte-for-byte unchanged. Only the
  // ORDER differs: a higher-weight agent's turns are now spread across the
  // cycle instead of bunched, so no other eligible agent waits through a
  // back-to-back assignment unless the weights mathematically force it (one
  // agent far out-weighing a lone teammate). Equal weights → plain round robin.
  const cycle = buildSmoothWeightedCycle(sorted, (a) => Math.max(1, weightFn(a)));
  const nextCursor = await advanceCursor();
  return cycle[(nextCursor - 1) % cycle.length];
}

// Smooth Weighted Round Robin — Nginx's algorithm, expanded over ONE full
// period. Each step adds every agent's weight to its running "current",
// selects the agent with the highest current (ties broken by the sorted
// order — lowest tier, then lowest id), then subtracts the total weight from
// the winner. Over `total` steps this emits each agent exactly `weight`
// times, interleaved as evenly as the weights allow, and returns every
// current to zero (so the sequence is periodic — identical period length to
// the old block cycle). The current-weight state is LOCAL to this one
// expansion and is never persisted: the durable per-company assignment cursor
// remains the only cross-call rotation state, unchanged.
function buildSmoothWeightedCycle(
  sorted: CandidateAgent[],
  weightOf: (a: CandidateAgent) => number
): string[] {
  const items = sorted.map((a) => ({ id: a.id, weight: weightOf(a), current: 0 }));
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  const cycle: string[] = [];
  for (let n = 0; n < total; n++) {
    let bestIdx = 0;
    for (let i = 0; i < items.length; i++) {
      items[i].current += items[i].weight;
      if (items[i].current > items[bestIdx].current) bestIdx = i;
    }
    items[bestIdx].current -= total;
    cycle.push(items[bestIdx].id);
  }
  return cycle;
}

// Only the best tier present receives leads; rotate equally within it.
export async function rotateTopTier(
  agents: CandidateAgent[],
  advanceCursor: () => Promise<number>
): Promise<string> {
  const bestTier = agents.map(tierOf).sort()[0];
  const top = agents.filter((a) => tierOf(a) === bestTier);
  const nextCursor = await advanceCursor();
  const sorted = [...top].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[(nextCursor - 1) % sorted.length].id;
}
