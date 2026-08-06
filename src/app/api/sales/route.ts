import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sales, users } from "@/db/schema";
import { and, asc, count, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { requireSales, resolveSalesScope, currentSaleMonth } from "@/lib/sales/access";
import { isValidSaleMonth, isSaleStatus } from "@/lib/sales/types";
import { classifyProduct, productCategoryLabel } from "@/lib/sales/products";
import { parseInstallationDate, syncSaleReminders } from "@/lib/sales/reminders";
import { recordAudit } from "@/lib/audit";
import { checkPolicy } from "@/lib/rate-limit";
import { isUuid } from "@/lib/url";

// Each month is its own sheet, sized for up to 500 sales — the whole month
// shows as ONE continuous sheet (like a spreadsheet tab) rather than paging
// every 100 rows. A month that somehow exceeds 500 still paginates beyond
// that, so no sale is ever hidden or lost.
const PAGE_SIZE = 500;

// Status counts for a month/scope — one grouped scan. Used for the header
// totals AND as the ENTIRE payload an agent gets once a month is past its
// visibility cutoff (no rows, no PII ever leave the server in that case).
async function monthSummary(companyId: string, month: string, agentId: string | null) {
  const rows = await db
    .select({ status: sales.activationStatus, value: count() })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.saleMonth, month),
        isNull(sales.deletedAt),
        ...(agentId ? [eq(sales.agentId, agentId)] : [])
      )
    )
    .groupBy(sales.activationStatus);
  const by = new Map(rows.map((r) => [r.status, r.value]));
  const active = by.get("active") || 0;
  const pending = by.get("pending") || 0;
  const cancelled = by.get("cancelled") || 0;
  const followUp = by.get("follow_up") || 0;
  return { total: active + pending + cancelled + followUp, active, pending, cancelled, follow_up: followUp };
}

export async function GET(req: NextRequest) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const p = req.nextUrl.searchParams;
  const month = isValidSaleMonth(p.get("month")) ? p.get("month")! : currentSaleMonth();
  const scope = await resolveSalesScope(session, month);

  // An agent is hard-scoped to their own rows; admin/manager see everyone and
  // may narrow to one agent via ?agentId=.
  const ownerId = scope.viewAll ? (isUuid(p.get("agentId") || "") ? p.get("agentId")! : null) : session.userId;
  const summary = await monthSummary(session.companyId, month, ownerId);

  const meta = {
    month,
    viewAll: scope.viewAll,
    canEdit: scope.canEdit,
    canManage: scope.canManage,
    canExport: scope.canExport,
    summaryOnly: !scope.canSeeDetail,
    summary,
  };

  // Agent past the cutoff (or anyone without detail rights): summary ONLY.
  if (!scope.canSeeDetail) {
    return NextResponse.json({ ...meta, rows: [], total: summary.total, page: 1, pageSize: PAGE_SIZE, agents: [] });
  }

  const search = p.get("search")?.trim();
  const status = p.get("status");
  const productFilter = p.get("product")?.trim() || null;
  const showDeleted = scope.canManage && p.get("deleted") === "1";
  const page = Math.max(1, parseInt(p.get("page") || "1", 10));

  // Product-family chips — count sales per product family for this month + agent
  // scope, independent of the status/search/product filters so the breakdown is
  // always the full picture. ONE grouped scan over the distinct product strings
  // (a small set), classified in JS; the exact strings per family are kept so
  // the product FILTER below matches the SAME rows the count reflects.
  const productScope = [eq(sales.companyId, session.companyId), eq(sales.saleMonth, month), isNull(sales.deletedAt)];
  if (!scope.viewAll) productScope.push(eq(sales.agentId, session.userId));
  else if (ownerId) productScope.push(eq(sales.agentId, ownerId));
  const productGroups = await db
    .select({ product: sales.product, value: count() })
    .from(sales)
    .where(and(...productScope))
    .groupBy(sales.product);
  const countByCat = new Map<string, number>();
  const membersByCat = new Map<string, string[]>();
  let otherHasNull = false;
  for (const g of productGroups) {
    const cat = classifyProduct(g.product);
    countByCat.set(cat, (countByCat.get(cat) || 0) + Number(g.value));
    if (g.product) {
      const arr = membersByCat.get(cat) || [];
      arr.push(g.product);
      membersByCat.set(cat, arr);
    } else if (cat === "other") {
      otherHasNull = true;
    }
  }
  const productCounts = [...countByCat.entries()]
    .map(([key, cnt]) => ({ key, label: productCategoryLabel(key), count: cnt }))
    .sort((a, b) => b.count - a.count);

  const conditions = [eq(sales.companyId, session.companyId), eq(sales.saleMonth, month)];
  // Deleted rows are hidden unless an admin explicitly asks to see them (to restore).
  if (!showDeleted) conditions.push(isNull(sales.deletedAt));
  if (!scope.viewAll) conditions.push(eq(sales.agentId, session.userId));
  else if (ownerId) conditions.push(eq(sales.agentId, ownerId));
  if (status && isSaleStatus(status)) conditions.push(eq(sales.activationStatus, status));
  if (search) {
    const like = `%${search}%`;
    const c = or(ilike(sales.customerName, like), ilike(sales.phone, like), ilike(sales.product, like), ilike(sales.notes, like));
    if (c) conditions.push(c);
  }
  // Product-family filter — the exact product strings for the chosen family
  // (+ null/blank for "other"), so it matches the chip's count exactly. An
  // unknown/empty family matches nothing.
  if (productFilter) {
    const members = membersByCat.get(productFilter) || [];
    const inMembers = members.length ? inArray(sales.product, members) : null;
    const includeNull = productFilter === "other" && otherHasNull ? isNull(sales.product) : null;
    conditions.push(inMembers && includeNull ? or(inMembers, includeNull)! : inMembers ?? includeNull ?? sql`false`);
  }

  const [rows, [{ total }], agents] = await Promise.all([
    db
      .select({
        id: sales.id,
        agentId: sales.agentId,
        agentName: users.name,
        saleMonth: sales.saleMonth,
        orderDate: sales.orderDate,
        installationDate: sales.installationDate,
        customerName: sales.customerName,
        phone: sales.phone,
        product: sales.product,
        autopay: sales.autopay,
        activationStatus: sales.activationStatus,
        notes: sales.notes,
        deletedAt: sales.deletedAt,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .leftJoin(users, eq(users.id, sales.agentId))
      .where(and(...conditions))
      // Oldest first, so a newly added sale appends at the BOTTOM of the sheet
      // (row N+1) instead of jumping to the top — the ledger stays in
      // chronological entry order (matching the export), and the serial column
      // reads 1→N top-to-bottom. id is the stable tiebreaker so rows created in
      // the same instant never shuffle across pages.
      .orderBy(asc(sales.createdAt), asc(sales.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(sales).where(and(...conditions)),
    // Agent filter list — only meaningful for the master view.
    scope.viewAll
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.companyId, session.companyId), eq(users.role, "agent"), eq(users.active, true), isNull(users.deletedAt)))
          .orderBy(asc(users.name))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  return NextResponse.json({ ...meta, rows, total, productCounts, page, pageSize: PAGE_SIZE, agents });
}

// Record a new sale. Agents create their own in the current month; admins and
// managers may set the agent (and month).
export async function POST(req: NextRequest) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const scope = await resolveSalesScope(session, currentSaleMonth());

  // Owner: an agent is always themselves; admin/manager may assign, but only to
  // an active agent of THIS company (tenant + membership scoped).
  let agentId = session.userId;
  if (scope.viewAll && typeof body?.agentId === "string" && isUuid(body.agentId)) {
    const [member] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, body.agentId), eq(users.companyId, session.companyId), isNull(users.deletedAt)))
      .limit(1);
    if (!member) return NextResponse.json({ error: "That agent could not be found in your company." }, { status: 404 });
    agentId = body.agentId;
  }

  // Agents always record into the current month; admins/managers may backdate.
  const saleMonth = scope.viewAll && isValidSaleMonth(body?.month) ? body.month : currentSaleMonth();
  const status = isSaleStatus(body?.activationStatus) ? body.activationStatus : "pending";

  const [row] = await db
    .insert(sales)
    .values({
      companyId: session.companyId,
      agentId,
      saleMonth,
      orderDate: typeof body?.orderDate === "string" ? body.orderDate.slice(0, 120) : null,
      installationDate: typeof body?.installationDate === "string" ? body.installationDate.slice(0, 120) : null,
      // Derived from the free-text installationDate — drives reminders/dashboard.
      installationAt: parseInstallationDate(typeof body?.installationDate === "string" ? body.installationDate : null),
      customerName: typeof body?.customerName === "string" ? body.customerName.slice(0, 200) : null,
      phone: typeof body?.phone === "string" ? body.phone.slice(0, 60) : null,
      product: typeof body?.product === "string" ? body.product.slice(0, 160) : null,
      autopay: body?.autopay === true,
      activationStatus: status,
      notes: typeof body?.notes === "string" ? body.notes : null,
      createdBy: session.userId,
    })
    .returning();

  await recordAudit({
    companyId: session.companyId,
    userId: session.userId,
    action: "sale.created",
    entityType: "sale",
    entityId: row.id,
    after: { saleMonth, customerName: row.customerName, product: row.product, activationStatus: row.activationStatus },
  });

  // Auto-generate installation reminders (only if the installation date parsed).
  await syncSaleReminders({
    saleId: row.id,
    companyId: session.companyId,
    agentId: row.agentId,
    installationAt: row.installationAt,
    actorUserId: session.userId,
  });

  return NextResponse.json({ sale: row }, { status: 201 });
}
