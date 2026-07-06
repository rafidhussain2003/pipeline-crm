// AI context builders (Part 1) — gather structured CRM data into a plain
// object shape that both the deterministic features (scoring, next-best-
// action) and the LLM-dependent features (summaries, email drafts) can
// consume. Kept separate from prompt rendering: a context object is
// reusable data, a prompt is one specific rendering of a template against
// that data.
import { db } from "@/db";
import { leads, leadNotes, users, tags, leadTags, assignmentLog } from "@/db/schema";
import { eq, desc, count } from "drizzle-orm";

export type LeadContext = {
  leadId: string;
  companyId: string;
  name: string | null;
  disposition: string;
  ownerId: string | null;
  ownerName: string | null;
  sourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  isDuplicate: boolean;
  noteCount: number;
  latestNote: string | null;
  tagLabels: string[];
  reassignmentCount: number;
};

export async function buildLeadContext(leadId: string): Promise<LeadContext | null> {
  const [lead] = await db
    .select({
      id: leads.id,
      companyId: leads.companyId,
      name: leads.name,
      disposition: leads.disposition,
      ownerId: leads.ownerId,
      ownerName: users.name,
      sourceId: leads.sourceId,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
      isDuplicate: leads.isDuplicate,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!lead) return null;

  const [{ value: noteCount }] = await db.select({ value: count() }).from(leadNotes).where(eq(leadNotes.leadId, leadId));
  const [latestNoteRow] = await db
    .select({ body: leadNotes.body })
    .from(leadNotes)
    .where(eq(leadNotes.leadId, leadId))
    .orderBy(desc(leadNotes.createdAt))
    .limit(1);

  const tagRows = await db
    .select({ label: tags.label })
    .from(leadTags)
    .innerJoin(tags, eq(leadTags.tagId, tags.id))
    .where(eq(leadTags.leadId, leadId));

  const [{ value: reassignmentCount }] = await db.select({ value: count() }).from(assignmentLog).where(eq(assignmentLog.leadId, leadId));

  return {
    leadId: lead.id,
    companyId: lead.companyId,
    name: lead.name,
    disposition: lead.disposition,
    ownerId: lead.ownerId,
    ownerName: lead.ownerName,
    sourceId: lead.sourceId,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    isDuplicate: lead.isDuplicate,
    noteCount,
    latestNote: latestNoteRow?.body || null,
    tagLabels: tagRows.map((t) => t.label),
    reassignmentCount,
  };
}
