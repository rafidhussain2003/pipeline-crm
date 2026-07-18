import { db } from "@/db";
import { leads } from "@/db/schema";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

/**
 * Looks for an existing, non-deleted lead in the same company with a
 * matching phone or email. Returns the id of the first match, or null.
 * Leads aren't blocked from being created when a duplicate is found —
 * they're flagged (isDuplicate / duplicateOfLeadId) so agents can see it
 * and decide, rather than silently dropping a lead that might be legitimate
 * (e.g. someone submitting a second inquiry).
 *
 * Ordered by (createdAt, id) so "the original" is deterministically the
 * OLDEST matching lead — a bare LIMIT 1 with no ORDER BY previously returned
 * an arbitrary row, so the same submission could point at different originals
 * on different runs.
 *
 * NOTE: this is a read. Using it BEFORE the insert is racy — concurrent
 * identical submissions all read "no duplicate" before any of them has
 * inserted, so every copy is stored unflagged (verified: 5 concurrent
 * identical submissions produced 0 flagged). Ingest paths must therefore use
 * flagDuplicateLead() AFTER the insert instead; this function remains for
 * read-only callers that just want to know whether a match exists.
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
    .orderBy(asc(leads.createdAt), asc(leads.id))
    .limit(1);

  return existing?.id || null;
}

/**
 * Race-free duplicate flagging, run AFTER the lead row exists.
 *
 * A single UPDATE that flags this lead if — and only if — a STRICTLY OLDER
 * lead in the same company shares its phone or email, ordering by
 * (created_at, id) so the comparison is a total order with no ties. Because
 * it runs post-insert, every concurrent sibling is already visible, so exactly
 * one lead in a burst (the oldest) stays unflagged and the rest point at it.
 * That is the property the previous check-then-insert could not provide.
 *
 * Returns the id of the original it was flagged against, or null if this lead
 * is the first of its kind.
 */
export async function flagDuplicateLead(
  leadId: string,
  companyId: string,
  phone?: string | null,
  email?: string | null,
): Promise<string | null> {
  if (!phone && !email) return null;

  // Only compare on the keys actually present — `p.phone = NULL` is never
  // true, so an absent key must be omitted rather than compared.
  const match =
    phone && email ? sql`(p.phone = ${phone} OR p.email = ${email})`
    : phone ? sql`p.phone = ${phone}`
    : sql`p.email = ${email}`;

  const result = await db.execute(sql`
    UPDATE leads AS l
       SET is_duplicate = true,
           duplicate_of_lead_id = orig.id
      FROM (
        SELECT p.id
          FROM leads p
         WHERE p.company_id = ${companyId}
           AND p.deleted_at IS NULL
           AND p.id <> ${leadId}
           AND ${match}
           AND (p.created_at, p.id) < (SELECT c.created_at, c.id FROM leads c WHERE c.id = ${leadId})
         ORDER BY p.created_at ASC, p.id ASC
         LIMIT 1
      ) AS orig
     WHERE l.id = ${leadId}
    RETURNING orig.id AS original_id
  `);

  const rows = (result as unknown as { rows: { original_id: string }[] }).rows ?? [];
  return rows[0]?.original_id ?? null;
}
