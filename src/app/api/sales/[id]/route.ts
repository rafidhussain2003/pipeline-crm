import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sales } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireSales, resolveSalesScope } from "@/lib/sales/access";
import { EDITABLE_FIELDS, isSaleStatus } from "@/lib/sales/types";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/url";

// Tenant + ownership scoped fetch: an agent can only ever reach their OWN row;
// admin/manager reach any row in their company. A missing / other-tenant /
// other-agent id all produce the same 404 (no existence oracle).
async function loadOwned(companyId: string, id: string, viewAll: boolean, agentId: string) {
  const [row] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, id), eq(sales.companyId, companyId), ...(viewAll ? [] : [eq(sales.agentId, agentId)])))
    .limit(1);
  return row || null;
}

// Inline cell edit — one or more editable fields. Agents may edit their own
// rows only while the month is still within its visibility window.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Resolve scope against the ROW's month (loaded first), so an agent past a
  // past-month cutoff can't edit history via a crafted request.
  const preScope = await resolveSalesScope(session, "0000-00");
  const row = await loadOwned(session.companyId, id, preScope.viewAll, session.userId);
  if (!row || row.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scope = await resolveSalesScope(session, row.saleMonth);
  if (!scope.canEdit) return NextResponse.json({ error: "This month is locked — editing is no longer allowed." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (!(key in body)) continue;
    let value = body[key];
    if (key === "autopay") value = value === true;
    else if (key === "activationStatus") {
      if (!isSaleStatus(value)) return NextResponse.json({ error: "Invalid activation status." }, { status: 400 });
    } else
      value =
        value === null
          ? null
          : String(value).slice(
              0,
              key === "notes"
                ? 5000
                : key === "customerName"
                ? 200
                : key === "orderDate" || key === "installationDate"
                ? 120
                : 160
            );
    set[key] = value;
    before[key] = (row as Record<string, unknown>)[key];
    after[key] = value;
  }
  if (Object.keys(set).length === 0) return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
  set.updatedAt = new Date();

  const [updated] = await db
    .update(sales)
    .set(set)
    .where(and(eq(sales.id, id), eq(sales.companyId, session.companyId), ...(scope.viewAll ? [] : [eq(sales.agentId, session.userId)])))
    .returning();
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "sale.updated", entityType: "sale", entityId: id, before, after });
  return NextResponse.json({ sale: updated });
}

// Soft delete — admin only. The row is hidden but recoverable (restore route).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const scope = await resolveSalesScope(session, "0000-00");
  if (!scope.canManage) return NextResponse.json({ error: "Only an admin can delete sales." }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [deleted] = await db
    .update(sales)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(sales.id, id), eq(sales.companyId, session.companyId), isNull(sales.deletedAt)))
    .returning({ id: sales.id });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "sale.deleted", entityType: "sale", entityId: id });
  return NextResponse.json({ ok: true });
}
