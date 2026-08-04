import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sales } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { requireSales, resolveSalesScope } from "@/lib/sales/access";
import { recordAudit } from "@/lib/audit";
import { isUuid } from "@/lib/url";

// Restore a soft-deleted sale — admin only, tenant-scoped.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSales();
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const scope = await resolveSalesScope(session, "0000-00");
  if (!scope.canManage) return NextResponse.json({ error: "Only an admin can restore sales." }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [restored] = await db
    .update(sales)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(sales.id, id), eq(sales.companyId, session.companyId), isNotNull(sales.deletedAt)))
    .returning({ id: sales.id });
  if (!restored) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({ companyId: session.companyId, userId: session.userId, action: "sale.restored", entityType: "sale", entityId: id });
  return NextResponse.json({ ok: true });
}
