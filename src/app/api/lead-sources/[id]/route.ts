import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leadSources, leadForms } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { and, eq, isNull } from "drizzle-orm";
import { disconnectOneSource } from "@/lib/lead-sources/actions";

// Detail view for one connection — "View Connected Forms" on the Lead
// Sources page. No token, ever: accessToken is deliberately excluded from
// every select in this file.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [source] = await db
    .select({
      id: leadSources.id,
      platform: leadSources.platform,
      accountId: leadSources.accountId,
      pageId: leadSources.pageId,
      pageName: leadSources.pageName,
      businessId: leadSources.businessId,
      businessName: leadSources.businessName,
      status: leadSources.status,
      webhookStatus: leadSources.webhookStatus,
      lastError: leadSources.lastError,
      tokenExpiresAt: leadSources.tokenExpiresAt,
      lastSyncedAt: leadSources.lastSyncedAt,
      createdAt: leadSources.createdAt,
    })
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Connection management is admin-only (matches the form enable/rename PATCH).
  // This also keeps the REAL form name — returned below — out of any lower
  // role's reach, satisfying "the actual form name must never be returned to
  // users who don't have permission" at the API, not just the UI.
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can view connection details" }, { status: 403 });
  }

  const forms = await db
    .select({
      id: leadForms.id,
      formId: leadForms.formId,
      formName: leadForms.formName,
      agentDisplayName: leadForms.agentDisplayName,
      enabled: leadForms.enabled,
    })
    .from(leadForms)
    .where(eq(leadForms.sourceId, id));

  return NextResponse.json({ source, forms });
}

// Disconnect one Page. See lib/lead-sources/actions.ts — shared with the
// account-level bulk disconnect endpoint.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Only company admins can disconnect a source" }, { status: 403 });
  }
  const { id } = await params;

  const [source] = await db
    .select()
    .from(leadSources)
    .where(and(eq(leadSources.id, id), eq(leadSources.companyId, session.companyId), isNull(leadSources.deletedAt)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await disconnectOneSource(source, { userId: session.userId, companyId: session.companyId });
  return NextResponse.json({ ok: true });
}
