import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users, webhookLogs, leadForms } from "@/db/schema";
import { getSession, type CompanySession } from "@/lib/auth";
import { leadVisibilityConditions } from "@/lib/leads/access";
import { isUuid } from "@/lib/url";
import { WON_DISPOSITIONS, LOST_DISPOSITIONS, TERMINAL_DISPOSITIONS } from "@/lib/dispositions/taxonomy";
import { resolveFormDisplayName, canSeeActualFormName } from "@/lib/leads/source-privacy";
import { and, count, desc, eq, exists, gte, ilike, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import "@/lib/assignment"; // registers the "lead.assign" job handler with the queue
import "@/lib/workflows/registry"; // registers the lead.created -> workflow listener
import { queue } from "@/lib/infra/queue";
import { eventBus } from "@/lib/events/bus";
import { flagDuplicateLead } from "@/lib/duplicates";
import { recordAudit } from "@/lib/audit";
import { normalizeLeadInput, hasIdentifyingField } from "@/lib/leads/input";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();
  const disposition = searchParams.get("disposition");
  const ownerId = searchParams.get("ownerId");
  // Enterprise Lead Filters — every one is ANDed onto the SAME
  // leadVisibilityConditions base (tenant + agent-ownership), so a filter can
  // only ever NARROW what the caller may already see; it can never widen scope
  // across tenants or (for an agent) beyond their own leads.
  const source = searchParams.get("source");
  const state = searchParams.get("state")?.trim();
  const saleStatus = searchParams.get("saleStatus"); // won | lost | in_progress
  const followUpToday = searchParams.get("followUpToday") === "1";
  const date = searchParams.get("date"); // yyyy-mm-dd — leads created that day
  const formId = searchParams.get("formId"); // Meta form id — leads from that form
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  // Phase 1A: caller-selectable page size, clamped to a fixed allow-list. Not a
  // free-form number — an arbitrary ?pageSize=100000 would let one request pull
  // the whole table into memory, which is exactly what server-side pagination
  // exists to prevent.
  const ALLOWED_PAGE_SIZES = [50, 75, 100];
  const requestedPageSize = parseInt(searchParams.get("pageSize") || "50", 10);
  const pageSize = ALLOWED_PAGE_SIZES.includes(requestedPageSize) ? requestedPageSize : 50;

  // Agent Portal: agents are hard-scoped to their OWN leads server-side —
  // leadVisibilityConditions adds ownerId = session.userId for them, and the
  // client's ?ownerId= filter is ignored so it can't widen the scope.
  const conditions = [...leadVisibilityConditions(session as CompanySession), isNull(leads.deletedAt)];
  if (disposition) conditions.push(eq(leads.disposition, disposition));
  if (ownerId && session.role !== "agent") conditions.push(eq(leads.ownerId, ownerId));
  // Source — a uuid FK. Validate first: a non-uuid reaching the uuid column
  // would surface as a 500 (22P02) instead of an empty result; an invalid
  // value is simply treated as "no source filter".
  if (source && isUuid(source)) conditions.push(eq(leads.sourceId, source));
  if (state) conditions.push(eq(leads.state, state));
  // Sale Status — derived from the disposition, using the SAME won/lost sets
  // the pipeline and analytics use (one source of truth). "in_progress" is any
  // still-open disposition (not a terminal won/lost one).
  if (saleStatus === "won") conditions.push(inArray(leads.disposition, WON_DISPOSITIONS));
  else if (saleStatus === "lost") conditions.push(inArray(leads.disposition, LOST_DISPOSITIONS));
  else if (saleStatus === "in_progress") conditions.push(notInArray(leads.disposition, TERMINAL_DISPOSITIONS));
  // Follow-up Today — a callback/follow-up scheduled within today's window
  // (server-local day boundaries, same basis as the rest of the app).
  if (followUpToday) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    conditions.push(and(gte(leads.followUpAt, start), lt(leads.followUpAt, end))!);
  }
  // Created-on date — a single calendar day (yyyy-mm-dd). Range-capable at the
  // query level (>= start of day, < next day) so a future from/to UI is a
  // trivial extension.
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const start = new Date(`${date}T00:00:00`);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      conditions.push(and(gte(leads.createdAt, start), lt(leads.createdAt, end))!);
    }
  }
  // Form filter — a lead's form lives on its delivery log (webhook_logs), not
  // the lead row, so this is an EXISTS on that link. The value is the Meta form
  // id; agents pick it from a display-name-labelled dropdown, admins from an
  // actual-name-labelled one, but the underlying id (and therefore the result)
  // is identical — role only changes the LABEL, never which leads match.
  if (formId) {
    conditions.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(webhookLogs)
          .where(and(eq(webhookLogs.leadId, leads.id), eq(webhookLogs.formId, formId)))
      )
    );
  }
  if (search) {
    const searchCond = or(
      ilike(leads.name, `%${search}%`),
      ilike(leads.phone, `%${search}%`),
      ilike(leads.email, `%${search}%`)
    );
    if (searchCond) conditions.push(searchCond);
  }

  // The page of rows and the total count are independent — fired together so
  // the endpoint pays ONE database round trip of latency, not two in series
  // (this endpoint runs on every list view, search, page change and realtime
  // reload — it was the single hottest serial wait in the app). The count
  // deliberately has no users join: conditions only reference leads columns,
  // and a LEFT JOIN can never change the row count — it only made Postgres
  // do the join work for a number.
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        disposition: leads.disposition,
        followUpAt: leads.followUpAt,
        createdAt: leads.createdAt,
        ownerId: leads.ownerId,
        ownerName: users.name,
        isDuplicate: leads.isDuplicate,
      })
      .from(leads)
      .leftJoin(users, eq(leads.ownerId, users.id))
      .where(and(...conditions))
      // createdAt DESC is the product requirement (newest first). leads.id DESC is
      // the tiebreaker that makes it a TOTAL order: two leads sharing a createdAt
      // (a burst import, or two webhook deliveries in the same instant) would
      // otherwise have no defined relative order, and Postgres is free to return
      // them differently per query — which with LIMIT/OFFSET silently duplicates a
      // row on one page and drops another. Never remove the second key.
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    // Total matching rows for the paginator. Counted with the SAME conditions
    // as the page query so the page count can't disagree with what's listed,
    // and as a COUNT rather than a fetch — the row data never leaves Postgres.
    db
      .select({ total: count() })
      .from(leads)
      .where(and(...conditions)),
  ]);

  // Role-aware Form name per lead (the "Form" column). Kept OUT of the hot
  // rows/count query above: one extra query bounded to THIS page's lead ids
  // (never the whole table), joining the delivery log to the form. `form` is
  // the DISPLAY NAME (alias) for EVERYONE, admins included; admins additionally
  // get the actual name (formActual) for the tooltip. A lead with no provider
  // form (CSV/manual/website) simply has form: null.
  const canSeeActual = canSeeActualFormName(session.role);
  let leadsOut: ((typeof rows)[number] & { form: string | null; formActual: string | null })[] = rows.map((r) => ({
    ...r,
    form: null,
    formActual: null,
  }));
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const formRows = await db
      .selectDistinctOn([webhookLogs.leadId], {
        leadId: webhookLogs.leadId,
        formName: leadForms.formName,
        displayName: leadForms.agentDisplayName,
      })
      .from(webhookLogs)
      .innerJoin(leadForms, and(eq(leadForms.sourceId, webhookLogs.sourceId), eq(leadForms.formId, webhookLogs.formId)))
      .where(and(inArray(webhookLogs.leadId, ids), isNotNull(webhookLogs.formId)))
      .orderBy(webhookLogs.leadId);
    const byLead = new Map(formRows.map((f) => [f.leadId, f]));
    leadsOut = rows.map((r) => {
      const f = byLead.get(r.id);
      return {
        ...r,
        form: f ? resolveFormDisplayName(session.role, f.formName, f.displayName) : null,
        formActual: f && canSeeActual ? f.formName ?? null : null,
      };
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return NextResponse.json({ leads: leadsOut, page, pageSize, total, totalPages });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // A malformed body must be a 400, not an unhandled throw surfacing as a 500.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  // Same normalizer every other entry point uses: coerces types, trims,
  // truncates to the column width. Previously these went into the insert raw,
  // so a non-string or over-length field became a Postgres error → 500, and a
  // missing name stored NULL where every other path stores "Unknown".
  const input = normalizeLeadInput(body);
  if (!hasIdentifyingField(input)) {
    return NextResponse.json({ error: "A lead needs at least one of: name, phone, email" }, { status: 400 });
  }

  const [lead] = await db
    .insert(leads)
    .values({
      companyId: session.companyId,
      name: input.name || "Unknown",
      phone: input.phone,
      email: input.email,
      disposition: input.disposition || "New Lead",
    })
    .returning();

  // Flagged after the insert — a pre-insert lookup is a check-then-insert race
  // that concurrent identical submissions all pass (see flagDuplicateLead).
  const duplicateOfLeadId = await flagDuplicateLead(lead.id, session.companyId, input.phone, input.email);

  await eventBus.emit("lead.created", { leadId: lead.id, companyId: session.companyId, source: "manual" });

  try {
    // Routed through the job queue abstraction (src/lib/infra/queue.ts)
    // rather than calling assignLead() directly — today this still runs
    // inline (with automatic retry on transient failure), but this is the
    // seam where it moves off the request entirely once a real queue
    // backend exists, with no further changes needed here.
    await queue.enqueue("lead.assign", { leadId: lead.id, companyId: session.companyId });
  } catch (err) {
    // The lead was already created successfully — an assignment failure
    // shouldn't turn that into a failed request. Log it so it's visible,
    // but the lead is simply left unassigned rather than erroring out.
    console.error("Lead assignment failed after lead creation:", err);
  }
  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "lead.created",
    entityType: "lead",
    entityId: lead.id,
    metadata: { source: "manual", isDuplicate: !!duplicateOfLeadId },
  });

  // Reflect the post-insert duplicate flag — the row returned by the INSERT
  // predates flagDuplicateLead's UPDATE, so returning it raw would tell the
  // caller isDuplicate=false for a lead that is in fact flagged in the table.
  return NextResponse.json({ lead: { ...lead, isDuplicate: !!duplicateOfLeadId, duplicateOfLeadId } });
}
