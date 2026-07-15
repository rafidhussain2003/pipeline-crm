import type { CandidateAgent } from "../types";

// Shared selection primitives. Ported verbatim from the original
// chooseAgent() so every strategy produces byte-for-byte the same choice the
// monolithic engine did — this is the one place tie-break discipline lives.

export const tierOf = (a: CandidateAgent): string => a.tier || "1";

// How long an agent has been idle (waiting for a lead). No prior assignment
// = "waited forever" so a brand-new agent is preferred by idle-based modes.
export const idleMs = (a: CandidateAgent): number =>
  a.lastAssignedAt ? Date.now() - a.lastAssignedAt.getTime() : Number.MAX_SAFE_INTEGER;

// Build a rotation cycle (repeating each agent `weight` times) and pick the
// cursor'th slot — the fair, stateless-per-call core of every rotation mode.
export async function rotateWeighted(
  agents: CandidateAgent[],
  weightFn: (a: CandidateAgent) => number,
  advanceCursor: () => Promise<number>
): Promise<string> {
  const sorted = [...agents].sort((a, b) => tierOf(a).localeCompare(tierOf(b)) || a.id.localeCompare(b.id));
  const cycle: string[] = [];
  for (const agent of sorted) {
    const w = Math.max(1, weightFn(agent));
    for (let i = 0; i < w; i++) cycle.push(agent.id);
  }
  const nextCursor = await advanceCursor();
  return cycle[(nextCursor - 1) % cycle.length];
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
