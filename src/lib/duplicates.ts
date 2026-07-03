import { db } from "@/db";
import { leads } from "@/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";

/**
 * Looks for an existing, non-deleted lead in the same company with a
 * matching phone or email. Returns the id of the first match, or null.
 * Leads aren't blocked from being created when a duplicate is found —
 * they're flagged (isDuplicate / duplicateOfLeadId) so agents can see it
 * and decide, rather than silently dropping a lead that might be legitimate
 * (e.g. someone submitting a second inquiry).
 */
export async function findDuplicateLead(companyId: string, phone?: string | null, email?: string | null) {
  if (!phone && !email) return null;

  const conditions = [];
  if (phone) conditions.push(eq(leads.phone, phone));
  if (email) conditions.push(eq(leads.email, email));

  const matchCondition = conditions.length > 1 ? or(...conditions) : conditions[0];
  if (!matchCondition) return null;

  const [existing] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.companyId, companyId), isNull(leads.deletedAt), matchCondition))
    .limit(1);

  return existing?.id || null;
}
