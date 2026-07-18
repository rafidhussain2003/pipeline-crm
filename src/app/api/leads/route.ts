import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
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
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = 50;

  const conditions = [eq(leads.companyId, session.companyId), isNull(leads.deletedAt)];
  if (disposition) conditions.push(eq(leads.disposition, disposition));
  if (ownerId) conditions.push(eq(leads.ownerId, ownerId));
  if (search) {
    const searchCond = or(
      ilike(leads.name, `%${search}%`),
      ilike(leads.phone, `%${search}%`),
      ilike(leads.email, `%${search}%`)
    );
    if (searchCond) conditions.push(searchCond);
  }

  const rows = await db
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
    .orderBy(desc(leads.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ leads: rows, page, pageSize });
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
