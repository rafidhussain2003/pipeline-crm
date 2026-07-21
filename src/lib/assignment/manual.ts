// Which leads are MANUALLY assigned right now — the discriminator the
// autonomous engines use to keep their hands off explicit human decisions.
//
// A lead's latest assignment_log entry tells who assigned it last: the
// manual paths write ruleUsed "manual:bulk_assign" / "manual:supervisor" /
// "manual:direct_edit", while the engine writes its strategy name. A lead a
// human placed stays with that agent until a human moves it (the product
// rule: assigned means assigned) — but if the engine later reassigns it
// (after a manual unassign, say), the latest entry flips and automation
// applies again. One DISTINCT ON query, bounded by the caller's batch.
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function manuallyAssignedLeadIds(leadIds: string[]): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const res = await db.execute(sql`
    SELECT DISTINCT ON (lead_id) lead_id, rule_used
    FROM assignment_log
    WHERE lead_id IN (${sql.join(leadIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY lead_id, assigned_at DESC
  `);
  const rows = ((res as unknown as { rows: { lead_id: string; rule_used: string | null }[] }).rows ?? []);
  return new Set(rows.filter((r) => (r.rule_used ?? "").startsWith("manual:")).map((r) => r.lead_id));
}
