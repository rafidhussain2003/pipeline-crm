// Skills Engine (Phase 5) — loads each agent's skill set (bulk, cached) and
// grades an agent against a lead's skill requirements. Grading is a SCORE, not
// a gate: even a fallback (no-match) agent stays eligible, so skills sharpen
// routing without ever stopping lead flow.
import { db } from "@/db";
import { userSkills, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { cache } from "@/lib/infra/cache";

export interface LeadSkillRequirements {
  required: string[]; // must-haves (perfect match needs all)
  preferred: string[]; // nice-to-haves
  priority: string[]; // any of these strongly favored
}

export type SkillGrade = "perfect" | "preferred" | "partial" | "fallback" | "none";

// Parse a lead's requirements from the jsonb column, falling back to the
// legacy single requiredSkillId so pre-Phase-5 leads still route correctly.
export function parseLeadRequirements(lead: { skillRequirements: unknown; requiredSkillId: string | null }): LeadSkillRequirements {
  const sr = (lead.skillRequirements && typeof lead.skillRequirements === "object" ? lead.skillRequirements : null) as Partial<LeadSkillRequirements> | null;
  if (sr && (sr.required?.length || sr.preferred?.length || sr.priority?.length)) {
    return { required: sr.required ?? [], preferred: sr.preferred ?? [], priority: sr.priority ?? [] };
  }
  return { required: lead.requiredSkillId ? [lead.requiredSkillId] : [], preferred: [], priority: [] };
}

export function hasAnyRequirement(req: LeadSkillRequirements): boolean {
  return req.required.length > 0 || req.preferred.length > 0 || req.priority.length > 0;
}

// Bulk-load agent -> skill-id set for a company's agents, cached.
export async function getAgentSkills(companyId: string): Promise<Map<string, Set<string>>> {
  return cache.getOrSet(`agent-skills:${companyId}`, 30_000, async () => {
    const rows = await db
      .select({ userId: userSkills.userId, skillId: userSkills.skillId })
      .from(userSkills)
      .innerJoin(users, eq(users.id, userSkills.userId))
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)));
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      let s = m.get(r.userId);
      if (!s) { s = new Set(); m.set(r.userId, s); }
      s.add(r.skillId);
    }
    return m;
  });
}

// Grade an agent's skills against the lead's requirements. Score in [0,1]:
//   perfect (1.0)   all required + all preferred (if any)
//   preferred (0.85) all required present
//   partial (0.5)   some required, or a priority skill
//   fallback (0.15) none match (still eligible)
//   none (0.7)      the lead has no requirements — neutral
export function gradeSkillMatch(agentSkills: Set<string>, req: LeadSkillRequirements): { grade: SkillGrade; score: number } {
  if (!hasAnyRequirement(req)) return { grade: "none", score: 0.7 };

  const has = (id: string) => agentSkills.has(id);
  const allRequired = req.required.length === 0 || req.required.every(has);
  const allPreferred = req.preferred.length > 0 && req.preferred.every(has);
  const someRequired = req.required.some(has);
  const somePriority = req.priority.some(has);

  if (allRequired && (req.preferred.length === 0 || allPreferred)) return { grade: "perfect", score: 1.0 };
  if (allRequired) return { grade: "preferred", score: 0.85 };
  if (someRequired || somePriority) return { grade: "partial", score: 0.5 };
  return { grade: "fallback", score: 0.15 };
}
